import { useEffect, useState } from 'react';
import { api, type Campaign } from '../lib/api.js';

const STATE_BADGE: Record<string, { label: string; color: string }> = {
  ON: { label: 'ON', color: '#4caf50' },
  SUSPENDED: { label: 'PAUSE', color: '#ff9800' },
  OFF: { label: 'OFF', color: '#9e9e9e' },
  ARCHIVED: { label: 'ARCHIVED', color: '#9e9e9e' },
  ENDED: { label: 'ENDED', color: '#9e9e9e' },
};

export default function Campaigns() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .campaigns()
      .then((r) => setItems(r.campaigns))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1>📁 Кампании</h1>
      {loading && <div className="loader">Загрузка...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="empty-state">Кампаний нет</div>
      )}
      {items.map((c) => {
        const badge = STATE_BADGE[c.state] ?? { label: c.state, color: '#9e9e9e' };
        return (
          <div className="campaign-card" key={c.id}>
            <div className="title">{c.name}</div>
            <div className="meta" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                background: badge.color,
                color: '#fff',
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
              }}>{badge.label}</span>
              <span>ID {c.id}</span>
              <span>·</span>
              <span>{c.type}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
