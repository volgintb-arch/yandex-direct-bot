import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import ImagePicker from '../components/ImagePicker.js';

type Kind = 'search' | 'network';

export default function Create() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>('search');
  const [geo, setGeo] = useState('');
  const [budget, setBudget] = useState<number>(1500);
  const [cpl, setCpl] = useState<string>('');
  const [url, setUrl] = useState('');
  const [brief, setBrief] = useState('');
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!geo.trim() || !brief.trim() || budget < 100) {
      setError('Заполни Гео, Бюджет (≥100) и Бриф');
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
      });
      // Generation now runs in background — jump straight to the
      // approval page which polls until variants are ready.
      nav(`/approvals/${r.approvalId}`);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

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
          {loading ? '⏳ Запускаю генерацию...' : '🚀 Сгенерировать 3 варианта'}
        </button>
        <div className="muted" style={{ fontSize: 11, marginTop: 6, textAlign: 'center' }}>
          Генерация занимает 1–3 минуты. Можно закрыть приложение — черновик появится в «🗂 Черновики».
        </div>
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
