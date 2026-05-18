import React, { useState, useEffect } from 'react';
import { getSystemHealth, getSystemStats } from '../api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, []);

  const fetchData = async () => {
    try {
      const [h, s] = await Promise.all([getSystemHealth(), getSystemStats()]);
      setHealth(h);
      if (Array.isArray(s)) setStats(s);
      setError('');
    } catch (e) {
      setError('Failed to fetch system data');
    }
    setLoading(false);
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <h1 className="page-title">📊 Dashboard</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: (health?.cpu || 0) > 80 ? 'var(--red)' : 'var(--accent)' }}>
            {health?.cpu?.toFixed(1) || '0'}%
          </div>
          <div className="stat-label">CPU</div>
          <div className="stat-bar">
            <div className="stat-bar-fill" style={{ width: `${health?.cpu || 0}%`, background: (health?.cpu || 0) > 80 ? 'var(--red)' : 'var(--accent)' }} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: (health?.memory?.percent || 0) > 80 ? 'var(--red)' : 'var(--accent)' }}>
            {health?.memory?.percent?.toFixed(1) || '0'}%
          </div>
          <div className="stat-label">Memory</div>
          <div className="stat-bar">
            <div className="stat-bar-fill" style={{ width: `${health?.memory?.percent || 0}%`, background: 'var(--blue)' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            {health?.memory?.used ? (health.memory.used / 1024).toFixed(1) : '0'} GB / {(health?.memory?.total / 1024 || 0).toFixed(1)} GB
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: (health?.disk?.percent || 0) > 80 ? 'var(--red)' : 'var(--green)' }}>
            {health?.disk?.percent?.toFixed(1) || '0'}%
          </div>
          <div className="stat-label">Disk</div>
          <div className="stat-bar">
            <div className="stat-bar-fill" style={{ width: `${health?.disk?.percent || 0}%`, background: 'var(--green)' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            {health?.disk?.used ? (health.disk.used / 1024).toFixed(1) : '0'} GB / {(health?.disk?.total / 1024 || 0).toFixed(1)} GB
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: '1.5rem', color: 'var(--text)' }}>
            {health?.uptime ? `${Math.floor(health.uptime / 3600)}h` : '0h'}
          </div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">CPU & Memory Over Time</div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats}>
              <XAxis dataKey="tick" tick={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8 }}
                labelStyle={{ color: '#8b949e' }}
              />
              <Line type="monotone" dataKey="cpu" stroke="#00d4aa" strokeWidth={2} dot={false} name="CPU %" />
              <Line type="monotone" dataKey="memory" stroke="#58a6ff" strokeWidth={2} dot={false} name="Memory %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
