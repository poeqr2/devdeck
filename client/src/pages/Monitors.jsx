import React, { useState, useEffect } from 'react';
import { getMonitors, createMonitor, deleteMonitor, checkMonitor, getMonitorLogs } from '../api';

export default function Monitors() {
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', method: 'GET', interval_sec: 60, timeout_ms: 5000, expected_status: 200 });
  const [expandedId, setExpandedId] = useState(null);
  const [logs, setLogs] = useState({});

  useEffect(() => {
    fetchMonitors();
    const iv = setInterval(fetchMonitors, 10000);
    return () => clearInterval(iv);
  }, []);

  const fetchMonitors = async () => {
    try {
      const data = await getMonitors();
      setMonitors(Array.isArray(data) ? data : []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const handleCreate = async () => {
    try {
      await createMonitor(form);
      setShowModal(false);
      setForm({ name: '', url: '', method: 'GET', interval_sec: 60, timeout_ms: 5000, expected_status: 200 });
      fetchMonitors();
    } catch (e) { alert('Failed to create monitor'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this monitor?')) return;
    try { await deleteMonitor(id); fetchMonitors(); }
    catch (e) { alert('Delete failed'); }
  };

  const handleCheck = async (id) => {
    try { await checkMonitor(id); fetchMonitors(); }
    catch (e) { alert('Check failed'); }
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    try {
      const data = await getMonitorLogs(id);
      setLogs(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
    } catch (e) { setLogs(prev => ({ ...prev, [id]: [] })); }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">🔍 API Monitors</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Monitor</button>
      </div>

      {monitors.length === 0 ? (
        <div className="card">
          <p className="loading-text">No monitors yet. Add one to start monitoring.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Status</th>
                <th>Response</th>
                <th>Last Checked</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map(m => (
                <React.Fragment key={m.id}>
                  <tr className="clickable" onClick={() => toggleExpand(m.id)}>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.url}</td>
                    <td>
                      <span className={`status-dot ${m.last_status === 200 || m.is_up ? 'status-up' : 'status-down'}`} />
                      <span className={`badge ${m.last_status === 200 || m.is_up ? 'badge-up' : 'badge-down'}`}>
                        {m.last_status === 200 || m.is_up ? 'UP' : 'DOWN'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{m.last_response_time ? `${m.last_response_time}ms` : '-'}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{m.last_checked ? new Date(m.last_checked).toLocaleString() : 'Never'}</td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={(e) => { e.stopPropagation(); handleCheck(m.id); }}>Check</button>
                      <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }} style={{ marginLeft: '0.3rem' }}>Del</button>
                    </td>
                  </tr>
                  {expandedId === m.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '0.75rem 1rem 1rem' }}>
                        <strong style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Recent Logs</strong>
                        {(logs[m.id] || []).length === 0 ? (
                          <p className="loading-text" style={{ padding: '0.5rem' }}>No logs yet</p>
                        ) : (
                          <table className="table" style={{ fontSize: '0.8rem' }}>
                            <thead>
                              <tr>
                                <th>Time</th>
                                <th>Status</th>
                                <th>Response</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(logs[m.id] || []).slice(0, 10).map((log, i) => (
                                <tr key={i}>
                                  <td style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
                                    {new Date(log.checked_at || log.timestamp).toLocaleString()}
                                  </td>
                                  <td>
                                    <span className={`badge ${log.status_code === 200 || log.is_up ? 'badge-up' : 'badge-down'}`}>
                                      {log.status_code || 'ERR'}
                                    </span>
                                  </td>
                                  <td style={{ fontFamily: 'var(--mono)' }}>
                                    {log.response_time_ms ? `${log.response_time_ms}ms` : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Add Monitor</div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">URL</label>
              <input className="form-input" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://example.com/api" />
            </div>
            <div className="form-group">
              <label className="form-label">Method</label>
              <select className="form-select" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                <option>GET</option>
                <option>HEAD</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Interval (sec)</label>
              <input className="form-input" type="number" value={form.interval_sec} onChange={e => setForm(f => ({ ...f, interval_sec: +e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Timeout (ms)</label>
              <input className="form-input" type="number" value={form.timeout_ms} onChange={e => setForm(f => ({ ...f, timeout_ms: +e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
