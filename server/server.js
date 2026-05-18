// =============================================================================
// DevDeck Backend Server
// Express + SQLite + WebSocket server for the developer dashboard
// =============================================================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const axios = require('axios');
const osUtils = require('os-utils');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

const app = express();
const PORT = 3001;

// =============================================================================
// Middleware
// =============================================================================
app.use(cors());
app.use(express.json());
app.use(express.text({ type: '*/*' })); // capture raw bodies for webhook receiver

// =============================================================================
// Database Setup
// =============================================================================
const db = new Database(path.join(__dirname, 'devdeck.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create all tables
db.exec(`
  -- Uptime monitors
  CREATE TABLE IF NOT EXISTS monitors (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    url             TEXT    NOT NULL,
    method          TEXT    NOT NULL DEFAULT 'GET',
    interval_sec    INTEGER NOT NULL DEFAULT 60,
    timeout_ms      INTEGER NOT NULL DEFAULT 5000,
    expected_status INTEGER NOT NULL DEFAULT 200,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-check results for monitors
  CREATE TABLE IF NOT EXISTS monitor_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id       INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status_code      INTEGER,
    response_time_ms INTEGER,
    is_up            INTEGER NOT NULL DEFAULT 0,
    checked_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    error            TEXT
  );

  -- Registered webhook endpoints
  CREATE TABLE IF NOT EXISTS webhooks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    endpoint         TEXT    NOT NULL UNIQUE,  -- the token portion of the URL
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    last_triggered_at TEXT,
    trigger_count    INTEGER NOT NULL DEFAULT 0
  );

  -- Payloads received by webhooks
  CREATE TABLE IF NOT EXISTS webhook_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id  INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    method      TEXT    NOT NULL,
    headers     TEXT,   -- JSON string
    body        TEXT,
    received_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Scheduled cron jobs
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    expression  TEXT    NOT NULL,
    command     TEXT    NOT NULL,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    last_run    TEXT,
    last_status TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Execution history for cron jobs
  CREATE TABLE IF NOT EXISTS cron_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    started_at TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    exit_code  INTEGER,
    output     TEXT
  );

  -- Key/value settings store
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// =============================================================================
// In-memory circular buffer for system stats (60 data points)
// =============================================================================
const MAX_STATS_POINTS = 60;
const statsBuffer = []; // each entry: { timestamp, cpu, memUsed, memTotal, memPercent }

// =============================================================================
// Monitor scheduling — track active setInterval handles by monitor id
// =============================================================================
const monitorTimers = new Map(); // monitorId -> intervalHandle

// Perform a single HTTP check for a monitor row
async function checkMonitor(monitor) {
  const start = Date.now();
  let statusCode = null;
  let isUp = 0;
  let error = null;

  try {
    const response = await axios({
      method: monitor.method.toLowerCase(),
      url: monitor.url,
      timeout: monitor.timeout_ms,
      validateStatus: () => true, // don't throw on non-2xx
    });
    statusCode = response.status;
    isUp = statusCode === monitor.expected_status ? 1 : 0;
  } catch (err) {
    error = err.message;
    isUp = 0;
  }

  const responseTime = Date.now() - start;

  // Persist the log entry
  db.prepare(`
    INSERT INTO monitor_logs (monitor_id, status_code, response_time_ms, is_up, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(monitor.id, statusCode, responseTime, isUp, error);

  // Broadcast update over WebSocket so the UI refreshes in real time
  broadcastWS({ type: 'monitor_checked', monitorId: monitor.id, isUp, statusCode, responseTime });

  return { statusCode, responseTime, isUp, error };
}

// Schedule (or reschedule) a monitor's polling interval
function scheduleMonitor(monitor) {
  // Clear any existing timer for this monitor
  if (monitorTimers.has(monitor.id)) {
    clearInterval(monitorTimers.get(monitor.id));
    monitorTimers.delete(monitor.id);
  }

  if (!monitor.is_active) return;

  const handle = setInterval(() => {
    // Re-fetch the monitor in case it was updated
    const current = db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitor.id);
    if (current && current.is_active) {
      checkMonitor(current);
    } else {
      // Monitor was deactivated or deleted — stop the timer
      clearInterval(handle);
      monitorTimers.delete(monitor.id);
    }
  }, monitor.interval_sec * 1000);

  monitorTimers.set(monitor.id, handle);
}

// Boot: schedule all active monitors that already exist in the DB
function initMonitorSchedules() {
  const active = db.prepare('SELECT * FROM monitors WHERE is_active = 1').all();
  active.forEach(scheduleMonitor);
  console.log(`[monitors] Scheduled ${active.length} active monitor(s)`);
}

// =============================================================================
// Cron job scheduling via node-cron
// =============================================================================
const cron = require('node-cron');
const cronHandles = new Map(); // jobId -> cron.ScheduledTask

function runCronJob(job) {
  const logEntry = db.prepare(`
    INSERT INTO cron_logs (job_id, started_at) VALUES (?, datetime('now'))
  `).run(job.id);
  const logId = logEntry.lastInsertRowid;

  exec(job.command, { timeout: 30000 }, (err, stdout, stderr) => {
    const output = (stdout || '') + (stderr ? `\nSTDERR: ${stderr}` : '');
    const exitCode = err ? (err.code || 1) : 0;
    const status = exitCode === 0 ? 'success' : 'failed';

    db.prepare(`
      UPDATE cron_logs SET finished_at = datetime('now'), exit_code = ?, output = ? WHERE id = ?
    `).run(exitCode, output.trim(), logId);

    db.prepare(`
      UPDATE cron_jobs SET last_run = datetime('now'), last_status = ? WHERE id = ?
    `).run(status, job.id);

    broadcastWS({ type: 'cron_ran', jobId: job.id, status, exitCode });
  });
}

function scheduleCronJob(job) {
  if (cronHandles.has(job.id)) {
    cronHandles.get(job.id).stop();
    cronHandles.delete(job.id);
  }

  if (!job.is_active) return;

  if (!cron.validate(job.expression)) {
    console.warn(`[cron] Invalid expression for job ${job.id}: "${job.expression}"`);
    return;
  }

  const task = cron.schedule(job.expression, () => {
    const current = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(job.id);
    if (current && current.is_active) runCronJob(current);
  });

  cronHandles.set(job.id, task);
}

function initCronSchedules() {
  const active = db.prepare('SELECT * FROM cron_jobs WHERE is_active = 1').all();
  active.forEach(scheduleCronJob);
  console.log(`[cron] Scheduled ${active.length} active cron job(s)`);
}

// =============================================================================
// System stats collection — runs every 60 seconds
// =============================================================================
function collectSystemStats() {
  osUtils.cpuUsage((cpuPercent) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const point = {
      timestamp: new Date().toISOString(),
      cpu: Math.round(cpuPercent * 100 * 10) / 10, // percent, 1 decimal
      memUsed: usedMem,
      memTotal: totalMem,
      memPercent: Math.round((usedMem / totalMem) * 1000) / 10,
    };

    statsBuffer.push(point);
    if (statsBuffer.length > MAX_STATS_POINTS) statsBuffer.shift();

    broadcastWS({ type: 'stats_update', data: point });
  });
}

// Collect immediately on startup, then every 60 s
collectSystemStats();
setInterval(collectSystemStats, 60 * 1000);

// =============================================================================
// WebSocket server — attached to the same HTTP server
// =============================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[ws] Client connected');
  // Send the current stats buffer so the client can populate its charts immediately
  ws.send(JSON.stringify({ type: 'stats_history', data: statsBuffer }));

  ws.on('close', () => console.log('[ws] Client disconnected'));
  ws.on('error', (err) => console.error('[ws] Error:', err.message));
});

function broadcastWS(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  });
}

// =============================================================================
// MONITORS API
// =============================================================================

// POST /api/monitors — create a new monitor
app.post('/api/monitors', (req, res) => {
  const { name, url, method = 'GET', interval_sec = 60, timeout_ms = 5000, expected_status = 200, is_active = 1 } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }

  const result = db.prepare(`
    INSERT INTO monitors (name, url, method, interval_sec, timeout_ms, expected_status, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, url, method.toUpperCase(), interval_sec, timeout_ms, expected_status, is_active ? 1 : 0);

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
  scheduleMonitor(monitor);

  res.status(201).json(monitor);
});

// GET /api/monitors — list all monitors with their latest check result
app.get('/api/monitors', (req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors ORDER BY created_at DESC').all();

  // Attach the most recent log entry to each monitor
  const withStatus = monitors.map((m) => {
    const latest = db.prepare(`
      SELECT * FROM monitor_logs WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1
    `).get(m.id);
    return { ...m, latest_check: latest || null };
  });

  res.json(withStatus);
});

// GET /api/monitors/:id — get a single monitor with recent logs
app.get('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

  const logs = db.prepare(`
    SELECT * FROM monitor_logs WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 20
  `).all(monitor.id);

  res.json({ ...monitor, logs });
});

// PUT /api/monitors/:id — update a monitor
app.put('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

  const { name, url, method, interval_sec, timeout_ms, expected_status, is_active } = req.body;

  db.prepare(`
    UPDATE monitors
    SET name = ?, url = ?, method = ?, interval_sec = ?, timeout_ms = ?, expected_status = ?, is_active = ?
    WHERE id = ?
  `).run(
    name ?? monitor.name,
    url ?? monitor.url,
    (method ?? monitor.method).toUpperCase(),
    interval_sec ?? monitor.interval_sec,
    timeout_ms ?? monitor.timeout_ms,
    expected_status ?? monitor.expected_status,
    is_active !== undefined ? (is_active ? 1 : 0) : monitor.is_active,
    monitor.id
  );

  const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitor.id);
  scheduleMonitor(updated); // reschedule with new settings

  res.json(updated);
});

// DELETE /api/monitors/:id — delete a monitor and its logs
app.delete('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

  // Stop the timer
  if (monitorTimers.has(monitor.id)) {
    clearInterval(monitorTimers.get(monitor.id));
    monitorTimers.delete(monitor.id);
  }

  db.prepare('DELETE FROM monitors WHERE id = ?').run(monitor.id);
  res.json({ success: true });
});

// POST /api/monitors/:id/check — trigger an immediate manual check
app.post('/api/monitors/:id/check', async (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

  const result = await checkMonitor(monitor);
  res.json(result);
});

// GET /api/monitors/:id/logs — paginated log history
app.get('/api/monitors/:id/logs', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const logs = db.prepare(`
    SELECT * FROM monitor_logs WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?
  `).all(monitor.id, limit);

  res.json(logs);
});

// =============================================================================
// WEBHOOKS API
// =============================================================================

// POST /api/webhooks — register a new webhook endpoint
app.post('/api/webhooks', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Generate a random token to use as the public endpoint path
  const token = require('crypto').randomBytes(16).toString('hex');

  const result = db.prepare(`
    INSERT INTO webhooks (name, endpoint) VALUES (?, ?)
  `).run(name, token);

  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...webhook, url: `/api/hooks/${token}` });
});

// GET /api/webhooks — list all webhooks
app.get('/api/webhooks', (req, res) => {
  const webhooks = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  const withUrls = webhooks.map((w) => ({ ...w, url: `/api/hooks/${w.endpoint}` }));
  res.json(withUrls);
});

// DELETE /api/webhooks/:id — remove a webhook and its logs
app.delete('/api/webhooks/:id', (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

  db.prepare('DELETE FROM webhooks WHERE id = ?').run(webhook.id);
  res.json({ success: true });
});

// GET /api/webhooks/:id/logs — get received payloads for a webhook
app.get('/api/webhooks/:id/logs', (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const logs = db.prepare(`
    SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY received_at DESC LIMIT ?
  `).all(webhook.id, limit);

  // Parse headers back to objects for convenience
  const parsed = logs.map((l) => ({
    ...l,
    headers: l.headers ? JSON.parse(l.headers) : {},
  }));

  res.json(parsed);
});

// POST /api/hooks/:token — public receiver; stores whatever arrives
app.post('/api/hooks/:token', (req, res) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE endpoint = ?').get(req.params.token);
  if (!webhook) return res.status(404).json({ error: 'Unknown webhook endpoint' });

  // Capture headers (filter out noisy ones)
  const relevantHeaders = {};
  const skip = new Set(['host', 'connection', 'content-length']);
  for (const [k, v] of Object.entries(req.headers)) {
    if (!skip.has(k.toLowerCase())) relevantHeaders[k] = v;
  }

  // Body may be JSON, form data, or raw text
  let body = req.body;
  if (typeof body === 'object') {
    body = JSON.stringify(body);
  }

  db.prepare(`
    INSERT INTO webhook_logs (webhook_id, method, headers, body)
    VALUES (?, ?, ?, ?)
  `).run(webhook.id, req.method, JSON.stringify(relevantHeaders), body || null);

  // Update stats on the webhook row
  db.prepare(`
    UPDATE webhooks
    SET last_triggered_at = datetime('now'), trigger_count = trigger_count + 1
    WHERE id = ?
  `).run(webhook.id);

  broadcastWS({ type: 'webhook_received', webhookId: webhook.id });

  res.status(200).json({ received: true });
});

// =============================================================================
// CRON JOBS API
// =============================================================================

// POST /api/cron — create a new cron job
app.post('/api/cron', (req, res) => {
  const { name, expression, command, description, is_active = 1 } = req.body;

  if (!name || !expression || !command) {
    return res.status(400).json({ error: 'name, expression, and command are required' });
  }

  if (!cron.validate(expression)) {
    return res.status(400).json({ error: `Invalid cron expression: "${expression}"` });
  }

  const result = db.prepare(`
    INSERT INTO cron_jobs (name, expression, command, description, is_active)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, expression, command, description || null, is_active ? 1 : 0);

  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(result.lastInsertRowid);
  scheduleCronJob(job);

  res.status(201).json(job);
});

// GET /api/cron — list all cron jobs
app.get('/api/cron', (req, res) => {
  const jobs = db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all();
  res.json(jobs);
});

// PUT /api/cron/:id/toggle — enable or disable a cron job
app.put('/api/cron/:id/toggle', (req, res) => {
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Cron job not found' });

  const newState = job.is_active ? 0 : 1;
  db.prepare('UPDATE cron_jobs SET is_active = ? WHERE id = ?').run(newState, job.id);

  const updated = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(job.id);
  scheduleCronJob(updated);

  res.json(updated);
});

// DELETE /api/cron/:id — remove a cron job
app.delete('/api/cron/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Cron job not found' });

  if (cronHandles.has(job.id)) {
    cronHandles.get(job.id).stop();
    cronHandles.delete(job.id);
  }

  db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(job.id);
  res.json({ success: true });
});

// GET /api/cron/:id/logs — execution history for a cron job
app.get('/api/cron/:id/logs', (req, res) => {
  const job = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Cron job not found' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const logs = db.prepare(`
    SELECT * FROM cron_logs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?
  `).all(job.id, limit);

  res.json(logs);
});

// =============================================================================
// SYSTEM API
// =============================================================================

// GET /api/system/health — current snapshot of CPU, memory, disk, uptime
app.get('/api/system/health', (req, res) => {
  osUtils.cpuUsage((cpuPercent) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Disk usage — best-effort via df; falls back gracefully on Windows
    let disk = { used: 0, total: 0, percent: 0 };
    try {
      const dfOutput = execSync("df -k / | tail -1").toString().trim().split(/\s+/);
      // df columns: Filesystem, 1K-blocks, Used, Available, Use%, Mounted
      const totalKb = parseInt(dfOutput[1]);
      const usedKb = parseInt(dfOutput[2]);
      disk = {
        total: totalKb * 1024,
        used: usedKb * 1024,
        percent: Math.round((usedKb / totalKb) * 1000) / 10,
      };
    } catch (_) {
      // Non-Unix or permission issue — return zeros
    }

    res.json({
      cpu: Math.round(cpuPercent * 100 * 10) / 10,
      memory: {
        used: usedMem,
        total: totalMem,
        percent: Math.round((usedMem / totalMem) * 1000) / 10,
      },
      disk,
      uptime: os.uptime(), // seconds
      loadAvg: os.loadavg(), // [1m, 5m, 15m]
      platform: os.platform(),
      hostname: os.hostname(),
    });
  });
});

// GET /api/system/stats — historical buffer (up to 60 data points)
app.get('/api/system/stats', (req, res) => {
  res.json(statsBuffer);
});

// =============================================================================
// SETTINGS API
// =============================================================================

// GET /api/settings — retrieve all settings as a flat object
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => {
    // Try to parse JSON values; fall back to raw string
    try {
      settings[r.key] = JSON.parse(r.value);
    } catch (_) {
      settings[r.key] = r.value;
    }
  });
  res.json(settings);
});

// POST /api/settings — upsert one or more settings
app.post('/api/settings', (req, res) => {
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body must be a JSON object of key/value pairs' });
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const upsertMany = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  });

  upsertMany(Object.entries(req.body));

  // Return the full updated settings object
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => {
    try { settings[r.key] = JSON.parse(r.value); } catch (_) { settings[r.key] = r.value; }
  });

  res.json(settings);
});

// =============================================================================
// Startup
// =============================================================================
initMonitorSchedules();
initCronSchedules();

server.listen(PORT, () => {
  console.log(`[devdeck] Server running on http://localhost:${PORT}`);
  console.log(`[devdeck] WebSocket available on ws://localhost:${PORT}`);
});

// Graceful shutdown — stop all timers and close the DB
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('[devdeck] Shutting down...');
  monitorTimers.forEach((handle) => clearInterval(handle));
  cronHandles.forEach((task) => task.stop());
  db.close();
  server.close(() => process.exit(0));
}