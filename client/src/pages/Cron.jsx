import React, { useState, useEffect } from 'react';
import { getCrons, createCron, toggleCron, deleteCron, getCronLogs } from '../api';

export default function Cron() {
  const [crons, setCrons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', expression: '', command: '', description: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [logs, setLogs] = useState({});

  useEffect(() => { fetchCrons(); }, []);

  const fetchCrons = async () => {
    try {
      const data = await getCrons();
      setCrons(Array.isArray(data) ? data : []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const handleCreate = async () => {
    try {
      await createCron(form);
      setShowModal(false);
      setForm({ name: '', expression: '', command: '', description: '' });
      fetchCrons();
    } catch (e) { alert('Failed to create cron job'); }
  };

  const handleToggle = async (id) => {
    try { await toggleCron(id); fetchCrons(); }
    catch (e) { alert('Toggle failed'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this cron job?')) return;
    try { await deleteCron(id); fetchCrons(); }
    catch (e) { alert('Delete failed'); }
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    try {
      const data = await getCronLogs(id);
      setLogs(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
    } catch (e) { setLogs(prev => ({ ...prev, [id]: [] })); }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">⏰ Cron Jobs</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Cron</button>
      </div>

      {crons.length === 0 ? (
        <div className="card"><p className="loading-text">No cron jobs yet.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Expression</th>
                <th>Last Run</th>
                <th>Status</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {crons.map(c => (
                <React.Fragment key={c.id}>
                  <tr className="clickable" onClick={() => toggleExpand(c.id)}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--accent)' }}>{c.expression}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                      {c.last_run ? new Date(c.last_run).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <span className={`badge ${c.last_status === 0 || c.last_status === 'completed' ? 'badge-up' : c.last_status ? 'badge-down' : 'badge-pending'}`}>
                        {c.last_status === 0 || c.last_status === 'completed' ? 'OK' : c.last_status ? 'FAIL' : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <div className={`toggle ${c.is_active ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleToggle(c.id); }}>
                        <div className="toggle-knob" />
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}>Del</button>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '0.75rem 1rem 1rem' }}>
                        {c.command && (
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Command: </strong>
                            <code style={{ fontSize: '0.78rem', color: 'var(--text)' }}>{c.command}</code>
                          </div>
                        )}
                        {c.description && (
                          <div style={{ marginBottom: '0.5rem' }}>
                            <strong style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Description: </strong>
                            <span style={{ fontSize: '0.85rem' }}>{c.description}</span>
                          </div>
                        )}
                        <strong style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Execution History</strong>
                        {(logs[c.id] || []).length === 0 ? (
                          <p className="loading-text" style={{ padding: '0.5rem' }}>No runs yet</p>
                        ) : (
                          <table className="table" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                            <thead>
                              <tr>
                                <th>Started</th>
                                <th>Finished</th>
                                <th>Exit Code</th>
                                <th>Output</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(logs[c.id] || []).slice(0, 10).map((log, i) => (
                                <tr key={i}>
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
                                    {log.started_at ? new Date(log.started_at).toLocaleString() : '-'}
                                  </td>
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
                                    {log.finished_at ? new Date(log.finished_at).toLocaleString() : '-'}
                                  </td>
                                  <td>
                                    <span className={`badge ${log.exit_code === 0 ? 'badge-up' : 'badge-down'}`}>
                                      {log.exit_code ?? 'N/A'}
                                    </span>
                                  </td>
                                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.75rem' }}>
                                    {log.output || '-'}
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
            <div className="modal-title">Add Cron Job</div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Cron Expression</label>
              <input className="form-input" value={form.expression} onChange={e => setForm(f => ({ ...f, expression: e.target.value }))} placeholder="*/5 * * * *" />
            </div>
            <div className="form-group">
              <label className="form-label">Command</label>
              <input className="form-input" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} placeholder="node /path/to/script.js" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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
