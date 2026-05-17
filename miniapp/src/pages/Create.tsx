import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Variant } from '../lib/api.js';

type Kind = 'search' | 'network';

export default function Create() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>('search');
  const [geo, setGeo] = useState('');
  const [budget, setBudget] = useState<number>(1500);
  const [cpl, setCpl] = useState<string>('');
  const [url, setUrl] = useState('');
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  async function submit() {
    if (!geo.trim() || !brief.trim() || budget < 100) {
      setError('Заполни Гео, Бюджет (≥100) и Бриф');
      return;
    }
    setError(null);
    setLoading(true);
    setVariants(null);
    try {
      const r = await api.createCampaign({
        kind,
        geo: geo.trim(),
        budget,
        cpl: cpl ? parseInt(cpl, 10) : undefined,
        url: url.trim() || undefined,
        brief: brief.trim(),
      });
      setVariants(r.variants);
      setApprovalId(r.approvalId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function apply(variantId: string) {
    if (!approvalId) return;
    setApplying(variantId);
    try {
      const r = await api.applyApproval(approvalId, variantId);
      alert(
        `✅ Применено!\n\nКампания: ${r.campaignCreated ? '🆕 создана' : '♻️ существующая'}\nID ${r.campaignId}\nОбъявление ID ${r.adId}\nКлючевиков: ${r.keywordsAdded}${
          r.imageAttached ? '\n🖼 Картинка прикреплена' : ''
        }`
      );
      nav('/approvals');
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setApplying(null);
    }
  }

  return (
    <div>
      <h1>➕ Создать рекламу</h1>

      {!variants && (
        <div className="section">
          <div style={{ marginBottom: 12 }}>
            <label className="muted">Тип кампании</label>
            <div className="period-switch" style={{ marginTop: 4 }}>
              <button className={kind === 'search' ? 'active' : ''} onClick={() => setKind('search')}>
                🔍 Поиск
              </button>
              <button className={kind === 'network' ? 'active' : ''} onClick={() => setKind('network')}>
                📡 РСЯ
              </button>
            </div>
          </div>

          <Field label="Город (например: Краснодар)" value={geo} onChange={setGeo} />
          <Field
            label="Дневной бюджет, ₽"
            value={String(budget)}
            onChange={(v) => setBudget(parseInt(v, 10) || 0)}
            type="number"
          />
          <Field
            label="Целевой CPL, ₽ (пусто = ИИ предложит)"
            value={cpl}
            onChange={setCpl}
            type="number"
            placeholder="800"
          />
          <Field
            label="Ссылка (пусто = сайт по умолчанию)"
            value={url}
            onChange={setUrl}
            placeholder="https://brn.questlegends.ru"
          />
          <div style={{ marginTop: 12 }}>
            <label className="muted">Бриф для ИИ — что рекламируем, кому, в честь чего</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              style={textareaStyle}
              placeholder="Реклама квестов на день рождения для детей 10-14 лет. Подчеркнуть атмосферу приключения, новые сюжеты на тему пиратов. Скидка 15% на первое бронирование."
            />
          </div>

          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

          <button
            disabled={loading}
            onClick={submit}
            style={{
              width: '100%',
              marginTop: 16,
              padding: 14,
              background: 'var(--tg-button)',
              color: 'var(--tg-button-text)',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {loading ? '⏳ Генерирую...' : '🚀 Сгенерировать 3 варианта'}
          </button>
        </div>
      )}

      {variants && (
        <>
          <h2>3 варианта объявлений</h2>
          {variants.map((v) => (
            <div className="campaign-card" key={v.variant_id}>
              <div className="title">{v.title}</div>
              <div className="muted">{v.strategy_explanation}</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>{v.draft.ad.title1}</strong>
                {v.draft.ad.title2 && <span> | {v.draft.ad.title2}</span>}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{v.draft.ad.text}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {v.draft.keywords.length} ключей · {v.draft.negative_keywords.length} минус-слов
              </div>
              <button
                disabled={applying !== null}
                onClick={() => apply(v.variant_id)}
                style={{
                  marginTop: 8,
                  padding: '8px 16px',
                  background: 'var(--tg-button)',
                  color: 'var(--tg-button-text)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                {applying === v.variant_id ? '⏳ Применяю...' : '✅ Применить в Директ'}
              </button>
            </div>
          ))}
          <button
            onClick={() => { setVariants(null); setApprovalId(null); }}
            style={{
              width: '100%',
              marginTop: 12,
              padding: 12,
              background: 'var(--tg-secondary)',
              color: 'var(--tg-text)',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            ↩️ Создать другую
          </button>
        </>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: 10,
  marginTop: 4,
  background: 'var(--tg-secondary)',
  color: 'var(--tg-text)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 14,
} as const;

const textareaStyle = { ...inputStyle, fontFamily: 'inherit', resize: 'vertical' } as const;

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <label className="muted">{props.label}</label>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        style={inputStyle}
      />
    </div>
  );
}
