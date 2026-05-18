const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  // 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

// ── Monitors ──────────────────────────────────────────────
export const getMonitors = () =>
  request('/monitors');

export const createMonitor = (monitor) =>
  request('/monitors', {
    method: 'POST',
    body: JSON.stringify(monitor),
  });

export const updateMonitor = (id, monitor) =>
  request(`/monitors/${id}`, {
    method: 'PUT',
    body: JSON.stringify(monitor),
  });

export const deleteMonitor = (id) =>
  request(`/monitors/${id}`, { method: 'DELETE' });

export const checkMonitor = (id) =>
  request(`/monitors/${id}/check`, { method: 'POST' });

export const getMonitorLogs = (id) =>
  request(`/monitors/${id}/logs`);

// ── Webhooks ──────────────────────────────────────────────
export const getWebhooks = () =>
  request('/webhooks');

export const createWebhook = (name) =>
  request('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const deleteWebhook = (id) =>
  request(`/webhooks/${id}`, { method: 'DELETE' });

export const getWebhookLogs = (id) =>
  request(`/webhooks/${id}/logs`);

// ── Cron Jobs ─────────────────────────────────────────────
export const getCrons = () =>
  request('/cron');

export const createCron = (cron) =>
  request('/cron', {
    method: 'POST',
    body: JSON.stringify(cron),
  });

export const toggleCron = (id) =>
  request(`/cron/${id}/toggle`, { method: 'PUT' });

export const deleteCron = (id) =>
  request(`/cron/${id}`, { method: 'DELETE' });

export const getCronLogs = (id) =>
  request(`/cron/${id}/logs`);

// ── System ────────────────────────────────────────────────
export const getSystemHealth = () =>
  request('/system/health');

export const getSystemStats = () =>
  request('/system/stats');

// ── Settings ──────────────────────────────────────────────
export const getSettings = () =>
  request('/settings');

export const updateSettings = (settings) =>
  request('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
