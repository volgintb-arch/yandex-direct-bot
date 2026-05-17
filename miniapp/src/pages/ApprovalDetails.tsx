import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, type Variant } from '../lib/api.js';

interface Approval {
  id: string;
  status: string;
  campaignType: string;
  geo: string;
  dailyBudget: number;
  targetCpl: number | null;
  siteUrl: string;
  selectedVariantId: string | null;
  variants: Variant[];
  selectedImageHashes: string[];
  createdAt: string;
}

export default function ApprovalDetails() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [revisionText, setRevisionText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    if (!id) return;
    setError(null);
    api.approvalDetails(id).then(setData).catch((e) => setError((e as Error).message));
  }

  useEffect(reload, [id]);

  async function applyVariant(variantId: string) {
    if (!id) return;
    if (!confirm('Применить этот вариант в Яндекс.Директ?')) return;
    setBusy('apply-' + variantId);
    try {
      const r = await api.applyApproval(id, variantId);
      alert(
        `✅ Применено!\n\nКампания ${r.campaignCreated ? '🆕' : '♻️'} ${r.campaignId}\nОбъявление ${r.adId}\nКлючевиков: ${r.keywordsAdded}${r.imageAttached ? '\n🖼 Картинка прикреплена' : ''}`
      );
      nav('/approvals');
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!id || !confirm('Отклонить (удалить) черновик?')) return;
    setBusy('reject');
    try {
      await api.rejectApproval(id);
      nav('/approvals');
    } catch (e) {
      alert('❌ ' + (e as Error).message);
      setBusy(null);
    }
  }

  async function submitRevision(variantId: string) {
    if (!id || !revisionText.trim()) return;
    setBusy('revise-' + variantId);
    try {
      await api.reviseApproval(id, variantId, revisionText.trim());
      setReviseFor(null);
      setRevisionText('');
      reload();
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Загрузка...</div>;

  return (
    <div>
      <Link to="/approvals" style={{ color: 'var(--tg-link)', fontSize: 13 }}>← К списку</Link>
      <h1 style={{ marginTop: 8 }}>
        {data.campaignType === 'search' ? '🔍' : '📡'} {data.geo} · {data.dailyBudget}₽/день
      </h1>
      <div className="muted">
        CPL цель: {data.targetCpl ?? '—'} ₽ · {new Date(data.createdAt).toLocaleString('ru-RU')}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{data.siteUrl}</div>

      {data.status === 'pending' && (
        <button
          onClick={reject}
          disabled={busy !== null}
          style={{
            marginTop: 8,
            padding: '6px 14px',
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          🗑 Отклонить весь черновик
        </button>
      )}

      <h2 style={{ marginTop: 20 }}>Варианты ({data.variants.length})</h2>
      {data.variants.map((v) => {
        const d = v.draft;
        const limit = (n: number, m: number) => (n > m ? `⚠️${n}/${m}` : `${n}/${m}`);
        return (
          <div className="campaign-card" key={v.variant_id}>
            <div className="title">{v.title}</div>
            <div className="muted" style={{ fontSize: 12 }}>{v.strategy_explanation}</div>

            <div style={{ marginTop: 10, fontSize: 13 }}>
              <strong>{d.ad.title1}</strong>
              {d.ad.title2 && <span> | {d.ad.title2}</span>}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{d.ad.text}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              T1: {limit(d.ad.title1.length, 35)} · T2: {limit(d.ad.title2.length, 30)} · txt: {limit(d.ad.text.length, 81)}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {d.keywords.length} ключей · {d.negative_keywords.length} минус-слов
            </div>

            {data.status === 'pending' && (
              <>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button
                    onClick={() => applyVariant(v.variant_id)}
                    disabled={busy !== null}
                    style={btnPrimary}
                  >
                    {busy === 'apply-' + v.variant_id ? '⏳ Применяю...' : '✅ Применить'}
                  </button>
                  <button
                    onClick={() => { setReviseFor(reviseFor === v.variant_id ? null : v.variant_id); setRevisionText(''); }}
                    style={btnSecondary}
                  >
                    ✏️ Изменить
                  </button>
                </div>

                {reviseFor === v.variant_id && (
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      value={revisionText}
                      onChange={(e) => setRevisionText(e.target.value)}
                      rows={3}
                      placeholder="Опиши что изменить (например: убери упоминание скидки, сделай заголовок короче, добавь акцент на семью)"
                      style={{
                        width: '100%',
                        padding: 8,
                        background: 'var(--tg-secondary)',
                        color: 'var(--tg-text)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 6,
                        fontFamily: 'inherit',
                        fontSize: 12,
                        resize: 'vertical',
                      }}
                    />
                    <button
                      onClick={() => submitRevision(v.variant_id)}
                      disabled={busy === 'revise-' + v.variant_id || !revisionText.trim()}
                      style={{ ...btnPrimary, marginTop: 6, width: '100%' }}
                    >
                      {busy === 'revise-' + v.variant_id ? '⏳ ИИ переписывает...' : '🚀 Применить правки'}
                    </button>
                  </div>
                )}
              </>
            )}

            <details style={{ marginTop: 10 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                Показать ключевики и минус-слова
              </summary>
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <strong>Ключевики:</strong> {d.keywords.join(', ')}
              </div>
              <div style={{ marginTop: 4, fontSize: 11 }}>
                <strong>Минус-слова:</strong> {d.negative_keywords.join(', ')}
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}

const btnPrimary = {
  padding: '8px 14px',
  background: 'var(--tg-button)',
  color: 'var(--tg-button-text)',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  flex: 1,
} as const;

const btnSecondary = {
  padding: '8px 14px',
  background: 'var(--tg-secondary)',
  color: 'var(--tg-text)',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  flex: 1,
} as const;
