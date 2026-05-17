import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api, type CampaignDetails as Details } from '../lib/api.js';

const fmt = (n: number) => n.toLocaleString('ru-RU');

export default function CampaignDetails() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(null);
    api
      .campaignDetails(Number(id), days)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [id, days]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Загрузка...</div>;

  return (
    <div>
      <Link to="/campaigns" style={{ color: 'var(--tg-link)', fontSize: 13 }}>← К списку</Link>
      <h1 style={{ marginTop: 8 }}>{data.name}</h1>
      <div className="muted" style={{ marginBottom: 12 }}>
        {data.type} · {data.state}
      </div>

      <div className="period-switch">
        {[7, 14, 30, 90].map((d) => (
          <button key={d} className={d === days ? 'active' : ''} onClick={() => setDays(d)}>
            {d} дн
          </button>
        ))}
      </div>

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <Kpi label="💰 Расход" value={fmt(data.totals.cost) + '₽'} />
        <Kpi label="👁 Показов" value={fmt(data.totals.impressions)} />
        <Kpi label="🖱 Кликов" value={fmt(data.totals.clicks)} />
        <Kpi label="📊 CTR" value={data.totals.ctr + '%'} />
      </div>

      {data.crm && (
        <div className="section">
          <h3>📈 Воронка CRM (по utm_campaign)</h3>
          <div className="kpi-grid">
            <Kpi label="📥 Лидов" value={String(data.crm.leads)} />
            <Kpi label="✅ Оплачено" value={String(data.crm.scheduled)} />
            <Kpi label="🎉 Завершено" value={String(data.crm.completed)} />
            <Kpi label="❌ Отказ" value={String(data.crm.cancelled)} />
            <Kpi label="💵 Выручка" value={fmt(data.crm.revenue) + '₽'} />
            <Kpi label="💸 CPL" value={data.crm.cpl !== null ? fmt(data.crm.cpl) + '₽' : '—'} />
            <Kpi
              label="📈 ROI"
              value={data.crm.roi !== null ? Math.round(data.crm.roi * 100) + '%' : '—'}
            />
          </div>
        </div>
      )}

      {data.series.length > 0 && (
        <div className="section">
          <h3>График по дням</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.series}>
              <XAxis dataKey="date" stroke="var(--tg-hint)" fontSize={10} tickFormatter={(d) => d.slice(5)} />
              <YAxis stroke="var(--tg-hint)" fontSize={10} />
              <Tooltip />
              <Line type="monotone" dataKey="clicks" stroke="#3b82f6" name="Клики" />
              <Line type="monotone" dataKey="cost" stroke="#ef4444" name="Расход" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <h3>📝 Объявления ({data.ads.length})</h3>
      {data.ads.map((ad) => (
        <div className="campaign-card" key={ad.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{ad.title1}</strong>
            <span className={`badge ${ad.state === 'ON' ? 'on' : 'off'}`}>{ad.state}</span>
          </div>
          {ad.title2 && <div className="muted" style={{ fontSize: 12 }}>{ad.title2}</div>}
          <div style={{ fontSize: 13, marginTop: 4 }}>{ad.text}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{ad.url}</div>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
