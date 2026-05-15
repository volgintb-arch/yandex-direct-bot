import { useEffect, useState } from 'react';
import { api, type DashboardData } from '../lib/api.js';

const PERIODS = [7, 14, 30, 90];

const fmt = (n: number): string => n.toLocaleString('ru-RU');
const pct = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `${(n * 100).toFixed(0)}%`;

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .dashboard(days)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div>
      <h1>📊 Дашборд</h1>

      <div className="period-switch">
        {PERIODS.map((p) => (
          <button key={p} className={p === days ? 'active' : ''} onClick={() => setDays(p)}>
            {p} дн
          </button>
        ))}
      </div>

      {loading && <div className="loader">Загрузка...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && data?.empty && (
        <div className="empty-state">{data.message ?? 'Нет данных'}</div>
      )}

      {!loading && !error && data && !data.empty && data.totals && (
        <>
          <h2>Direct (за {days} дн)</h2>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">Расход</div>
              <div className="kpi-value">{fmt(data.totals.cost)} ₽</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Кликов</div>
              <div className="kpi-value">{fmt(data.totals.clicks)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Показы</div>
              <div className="kpi-value">{fmt(data.totals.impressions)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">CTR · CPC</div>
              <div className="kpi-value">{data.totals.ctr}% · {data.totals.avgCpc}₽</div>
            </div>
          </div>

          {data.crm && (
            <>
              <h2>CRM (yandex)</h2>
              <div className="kpi-grid">
                <div className="kpi">
                  <div className="kpi-label">Лидов</div>
                  <div className="kpi-value">{data.crm.leads}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Конверсия в оплату</div>
                  <div className="kpi-value">{data.crm.conversionRate}%</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Выручка</div>
                  <div className="kpi-value positive">{fmt(data.crm.revenue)} ₽</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">ROI</div>
                  <div
                    className={
                      'kpi-value ' +
                      (data.crm.roi !== null && data.crm.roi >= 0 ? 'positive' : 'negative')
                    }
                  >
                    {pct(data.crm.roi)}
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="row"><span className="label">🆕 Новые</span><span className="value">{data.crm.new}</span></div>
                <div className="row"><span className="label">🔄 В работе</span><span className="value">{data.crm.inWork}</span></div>
                <div className="row"><span className="label">✅ Согласовано / оплачено</span><span className="value">{data.crm.scheduled}</span></div>
                <div className="row"><span className="label">🎉 Завершено</span><span className="value">{data.crm.completed}</span></div>
                <div className="row"><span className="label">❌ Отказы</span><span className="value">{data.crm.cancelled}</span></div>
                <div className="row"><span className="label">CPL</span><span className="value">{data.crm.cpl !== null ? `${data.crm.cpl}₽` : '—'}</span></div>
              </div>
            </>
          )}

          {!data.crm && (
            <div className="muted" style={{ padding: 12 }}>
              CRM-данных пока нет. Запусти <code>/sync</code> в боте.
            </div>
          )}

          {data.topCampaigns && data.topCampaigns.length > 0 && (
            <>
              <h2>Топ-кампании по расходу</h2>
              {data.topCampaigns.map((c) => (
                <div className="campaign-card" key={c.campaignId}>
                  <div className="title">{c.campaignName}</div>
                  <div className="meta">
                    {c.campaignType} · {fmt(c.cost)}₽ расход · {c.clicks} кл · CTR {c.ctr}%
                  </div>
                  {c.leads !== undefined && c.leads > 0 && (
                    <div className="stats">
                      <span><strong>{c.leads}</strong>лидов</span>
                      <span><strong>{c.scheduled ?? 0}</strong>оплачено</span>
                      <span><strong>{c.cpl ?? '—'}</strong>CPL</span>
                      <span><strong>{pct(c.roi)}</strong>ROI</span>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
