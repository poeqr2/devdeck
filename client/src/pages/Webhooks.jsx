import React, { useState, useEffect } from 'react';
import { getWebhooks, createWebhook, deleteWebhook, getWebhookLogs } from '../api';

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [logs, setLogs] = useState({});
  const [copied, setCopied] = useState(null);

  useEffect(() => { fetchWebhooks(); }, []);

  const fetchWebhooks = async () => {
    try {
      const data = await getWebhooks();
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const handleCreate = async () => {
    try {
      await createWebhook(name);
      setShowModal(false);
      setName('');
      fetchWebhooks();
    } catch (e) { alert('Failed to create webhook'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this webhook?')) return;
    try { await deleteWebhook(id); fetchWebhooks(); }
    catch (e) { alert('Delete failed'); }
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    try {
      const data = await getWebhookLogs(id);
      setLogs(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
    } catch (e) { setLogs(prev => ({ ...prev, [id]: [] })); }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">📡 Webhooks</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Webhook</button>
      </div>

      {webhooks.length === 0 ? (
        <div className="card"><p className="loading-text">No webhooks yet.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Endpoint</th>
                <th>Received</th>
                <th>Last Triggered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map(w => (
                <React.Fragment key={w.id}>
                  <tr className="clickable" onClick={() => toggleExpand(w.id)}>
                    <td style={{ fontWeight: 600 }}>{w.name}</td>
                    <td>
                      <code style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>
                        /api/hooks/{w.token || w.endpoint?.split('/').pop() || w.id}
                      </code>
                      <button className="copy-btn" style={{ marginLeft: '0.3rem' }}
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(`${window.location.origin}/api/hooks/${w.token || w.endpoint?.split('/').pop() || w.id}`); }}>
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </td>
                    <td><span className="badge badge-up">{w.trigger_count || 0}</span></td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                      {w.last_triggered_at ? new Date(w.last_triggered_at).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleDelete(w.id); }}>Del</button>
                    </td>
                  </tr>
                  {expandedId === w.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0.75rem 1rem 1rem' }}>
                        <strong style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Received Payloads</strong>
                        {(logs[w.id] || []).length === 0 ? (
                          <p className="loading-text" style={{ padding: '0.5rem' }}>No payloads received yet</p>
                        ) : (
                          (logs[w.id] || []).slice(0, 10).map((log, i) => (
                            <div key={i} className="card" style={{ marginTop: '0.5rem', padding: '0.75rem' }}>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.3rem' }}>
                                {new Date(log.received_at || log.timestamp).toLocaleString()} — <strong>{log.method || 'POST'}</strong>
                              </div>
                              <div className="json-display">{JSON.stringify(JSON.parse(log.body || '{}'), null, 2)}</div>
                            </div>
                          ))
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
            <div className="modal-title">Add Webhook</div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="My Webhook" />
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
