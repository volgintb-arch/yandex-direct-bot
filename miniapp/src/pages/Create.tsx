import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import ImagePicker from '../components/ImagePicker.js';

type Kind = 'search' | 'network';
type Strategy = 'WB_MAXIMUM_CLICKS' | 'WB_MAXIMUM_CONVERSION_RATE' | 'AVERAGE_CPC';

const STRATEGIES: { value: Strategy; label: string; hint: string }[] = [
  {
    value: 'WB_MAXIMUM_CLICKS',
    label: '🖱 Максимум кликов',
    hint: 'Яндекс сам подбирает ставки, чтобы получить как можно больше кликов в рамках бюджета. Хороший старт для новых кампаний.',
  },
  {
    value: 'WB_MAXIMUM_CONVERSION_RATE',
    label: '🎯 Максимум конверсий',
    hint: 'Яндекс оптимизирует ставки под конверсии (нужна настроенная цель в Метрике). Лучше для зрелых кампаний с историей.',
  },
  {
    value: 'AVERAGE_CPC',
    label: '💰 Средняя цена клика',
    hint: 'Вы задаёте желаемую цену клика — Яндекс удерживает среднее на этом уровне. Подходит, если знаете сколько стоит клик для вас.',
  },
];

export default function Create() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>('search');
  const [geo, setGeo] = useState('');
  const [budget, setBudget] = useState<number>(1500);
  const [cpl, setCpl] = useState<string>('');
  const [url, setUrl] = useState('');
  const [brief, setBrief] = useState('');
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('WB_MAXIMUM_CLICKS');
  const [strategyBid, setStrategyBid] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!geo.trim() || !brief.trim() || budget < 100) {
      setError('Заполни Гео, Бюджет (≥100) и Бриф');
      return;
    }
    if (strategy === 'AVERAGE_CPC' && (!strategyBid || parseInt(strategyBid, 10) < 1)) {
      setError('Для стратегии «Средняя цена клика» укажи желаемую цену клика (₽)');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const r = await api.createCampaign({
        kind,
        geo: geo.trim(),
        budget,
        cpl: cpl ? parseInt(cpl, 10) : undefined,
        url: url.trim() || undefined,
        brief: brief.trim(),
        imageHash: kind === 'network' ? imageHash : null,
        strategy,
        strategyBid: strategy === 'AVERAGE_CPC' ? parseInt(strategyBid, 10) : undefined,
      });
      nav(`/approvals/${r.approvalId}`);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  const strategyInfo = STRATEGIES.find((s) => s.value === strategy)!;

  return (
    <div>
      <h1>➕ Создать рекламу</h1>

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

        {/* Bidding strategy */}
        <div style={{ marginTop: 12 }}>
          <label className="muted">Стратегия ставок Яндекс.Директ</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
            style={{
              ...inputStyle,
              marginTop: 4,
              appearance: 'none',
              WebkitAppearance: 'none',
              cursor: 'pointer',
            }}
          >
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.4 }}>
            {strategyInfo.hint}
          </div>
        </div>

        {strategy === 'AVERAGE_CPC' && (
          <Field
            label="Желаемая средняя цена клика, ₽"
            value={strategyBid}
            onChange={setStrategyBid}
            type="number"
            placeholder="30"
          />
        )}

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

        {kind === 'network' && (
          <ImagePicker value={imageHash} onChange={setImageHash} />
        )}

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
          {loading ? '⏳ Создаю черновик...' : '🚀 Сгенерировать 3 варианта'}
        </button>
      </div>
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
