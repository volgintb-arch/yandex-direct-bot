import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Approval } from '../lib/api.js';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: 'Ожидают' },
  { value: 'applied', label: 'Применённые' },
  { value: 'rejected', label: 'Отклонённые' },
];

export default function Approvals() {
  const [items, setItems] = useState<Approval[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .approvals(status)
      .then((r) => setItems(r.approvals))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function reject(id: string) {
    if (!confirm('Удалить (отклонить) этот черновик?')) return;
    setBusyId(id);
    try {
      await api.rejectApproval(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>🗂 Черновики</h1>
      <div className="period-switch">
        {STATUS_OPTIONS.map((s) => (
          <button key={s.value} className={s.value === status ? 'active' : ''} onClick={() => setStatus(s.value)}>
            {s.label}
          </button>
        ))}
      </div>

      {loading && <div className="loader">Загрузка...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="empty-state">Нет черновиков</div>
      )}

      {items.map((a) => (
        <div className="campaign-card" key={a.id}>
          <Link
            to={`/approvals/${a.id}`}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div className="title" style={{ cursor: 'pointer' }}>
              {a.campaignType === 'search' ? '🔍' : '📡'} {a.geo} · {a.dailyBudget}₽/день
              <span style={{ marginLeft: 6, color: 'var(--tg-link)', fontWeight: 400 }}>→</span>
            </div>
            <div className="meta">
              CPL цель: {a.targetCpl ?? '—'} · {new Date(a.createdAt).toLocaleString('ru-RU')}
            </div>
            {a.yandexAdId && (
              <div className="meta" style={{ marginTop: 4 }}>
                ✅ В Direct: ad #{a.yandexAdId} · campaign #{a.yandexCampaignId}
              </div>
            )}
          </Link>
          {status === 'pending' && (
            <button
              onClick={() => reject(a.id)}
              disabled={busyId === a.id}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {busyId === a.id ? '...' : '🗑 Удалить'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
