import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setLoading(true);
    api
      .approvals(status)
      .then((r) => setItems(r.approvals))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

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
          <div className="title">
            {a.campaignType === 'search' ? '🔍' : '📡'} {a.geo} · {a.dailyBudget}₽/день
          </div>
          <div className="meta">
            CPL цель: {a.targetCpl ?? '—'} · {new Date(a.createdAt).toLocaleString('ru-RU')}
          </div>
          {a.yandexAdId && (
            <div className="meta" style={{ marginTop: 4 }}>
              ✅ В Direct: ad #{a.yandexAdId} · campaign #{a.yandexCampaignId}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
