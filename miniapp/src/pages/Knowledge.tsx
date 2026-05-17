import { useEffect, useState } from 'react';
import { api, type KnowledgeEntry } from '../lib/api.js';

const TYPE_LABEL: Record<string, string> = {
  learned_rules: '📜 Выученные правила',
  top_ad: '🏆 Топ-объявление',
  failure_pattern: '💀 Что не работает',
  insight: '💡 Инсайт',
  document: '📄 Документ',
};

export default function Knowledge() {
  const [items, setItems] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [docName, setDocName] = useState('');
  const [docScope, setDocScope] = useState<'global' | 'search' | 'network'>('global');
  const [docText, setDocText] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editText, setEditText] = useState('');
  const [editScope, setEditScope] = useState<'global' | 'search' | 'network'>('global');

  function load() {
    setLoading(true);
    api
      .knowledge()
      .then((r) => setItems(r.entries))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function saveDoc() {
    if (!docName.trim() || !docText.trim()) return alert('Заполни название и текст');
    setSaving(true);
    try {
      await api.addKnowledgeDocument({
        name: docName.trim(),
        scope: docScope,
        text: docText.trim(),
      });
      setDocName('');
      setDocText('');
      setShowAdd(false);
      load();
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(e: KnowledgeEntry) {
    setEditingId(e.id);
    const data = e.data as { name?: string; text?: string; rules?: string };
    setEditName(data.name ?? '');
    setEditText(data.text ?? data.rules ?? '');
    setEditScope(
      e.scope === 'search' || e.scope === 'network' ? (e.scope as 'search' | 'network') : 'global'
    );
  }

  async function saveEdit(id: number, type: string) {
    setBusyId(id);
    try {
      // For learned_rules we update the `rules` field; for everything else — `text` + `name`
      const patch: { name?: string; text?: string; rules?: string; scope?: string } = {
        scope: editScope,
      };
      if (type === 'learned_rules') {
        patch.rules = editText;
      } else {
        patch.name = editName;
        patch.text = editText;
      }
      await api.editKnowledge(id, patch);
      setEditingId(null);
      load();
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function del(id: number) {
    if (!confirm('Удалить запись из базы знаний?')) return;
    setBusyId(id);
    try {
      await api.deleteKnowledge(id);
      setItems((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      alert('❌ ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>🧠 База знаний ИИ</h1>

      <button
        onClick={() => setShowAdd((v) => !v)}
        style={{
          padding: '8px 12px',
          background: 'var(--tg-button)',
          color: 'var(--tg-button-text)',
          border: 'none',
          borderRadius: 8,
          fontSize: 13,
          cursor: 'pointer',
          marginBottom: 12,
        }}
      >
        {showAdd ? '✕ Закрыть' : '➕ Добавить документ'}
      </button>

      {showAdd && (
        <div className="section">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Загрузи бриф, описание услуги, оффер, конкурентов и т.п. ИИ будет учитывать это при генерации.
          </div>
          <input
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="Название (например: Бриф квестов на ДР)"
            style={fieldStyle}
          />
          <div className="period-switch" style={{ marginTop: 8 }}>
            {(['global', 'search', 'network'] as const).map((s) => (
              <button key={s} className={docScope === s ? 'active' : ''} onClick={() => setDocScope(s)}>
                {s === 'global' ? 'Всё' : s === 'search' ? 'Поиск' : 'РСЯ'}
              </button>
            ))}
          </div>
          <textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            rows={8}
            placeholder="Вставь или напиши содержимое документа..."
            style={{ ...fieldStyle, marginTop: 8, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <button
            disabled={saving}
            onClick={saveDoc}
            style={{
              marginTop: 8,
              padding: '10px 16px',
              background: 'var(--tg-button)',
              color: 'var(--tg-button-text)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            {saving ? '⏳ Сохраняю...' : '💾 Сохранить'}
          </button>
        </div>
      )}

      {loading && <div className="loader">Загрузка...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          Знаний пока нет. Добавь документ выше или запусти <code>/learn</code> в боте.
        </div>
      )}
      {items.map((e) => {
        const data = e.data as Record<string, unknown>;
        const rules = (data.rules as string) ?? null;
        const text = (data.text as string) ?? null;
        const title1 = (data.title1 as string) ?? null;
        const name = (data.name as string) ?? null;
        return (
          <div className="campaign-card" key={e.id}>
            <div className="title">
              {TYPE_LABEL[e.type] ?? e.type} · {e.scope}
              {e.city ? ` · ${e.city}` : ''}
            </div>
            <div className="meta">{new Date(e.createdAt).toLocaleString('ru-RU')}</div>
            {name && <div style={{ marginTop: 8, fontWeight: 600 }}>{name}</div>}
            {rules && (
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 13 }}>
                {rules.slice(0, 600)}
                {rules.length > 600 ? '…' : ''}
              </div>
            )}
            {e.type === 'document' && text && (
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 13 }}>
                {text.slice(0, 500)}
                {text.length > 500 ? '…' : ''}
              </div>
            )}
            {title1 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>"{title1}"</strong>
                {text && e.type !== 'document' ? <div className="muted">{text.slice(0, 100)}</div> : null}
              </div>
            )}
            {editingId === e.id ? (
              <div style={{ marginTop: 10 }}>
                {e.type !== 'learned_rules' && (
                  <input
                    value={editName}
                    onChange={(ev) => setEditName(ev.target.value)}
                    placeholder="Название"
                    style={fieldStyle}
                  />
                )}
                <div className="period-switch" style={{ marginTop: 6 }}>
                  {(['global', 'search', 'network'] as const).map((s) => (
                    <button key={s} className={editScope === s ? 'active' : ''} onClick={() => setEditScope(s)}>
                      {s === 'global' ? 'Всё' : s === 'search' ? 'Поиск' : 'РСЯ'}
                    </button>
                  ))}
                </div>
                <textarea
                  value={editText}
                  onChange={(ev) => setEditText(ev.target.value)}
                  rows={8}
                  style={{ ...fieldStyle, marginTop: 6, fontFamily: 'inherit', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => saveEdit(e.id, e.type)}
                    disabled={busyId === e.id}
                    style={{ ...editBtn, background: 'var(--tg-button)', color: 'var(--tg-button-text)', flex: 1 }}
                  >
                    {busyId === e.id ? '...' : '💾 Сохранить'}
                  </button>
                  <button onClick={() => setEditingId(null)} style={{ ...editBtn, flex: 1 }}>✕ Отмена</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => startEdit(e)} style={editBtn}>✏️ Изменить</button>
                <button
                  onClick={() => del(e.id)}
                  disabled={busyId === e.id}
                  style={{ ...editBtn, background: '#ef4444', color: '#fff' }}
                >
                  {busyId === e.id ? '...' : '🗑 Удалить'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  padding: 10,
  background: 'var(--tg-secondary)',
  color: 'var(--tg-text)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 14,
} as const;

const editBtn = {
  padding: '6px 12px',
  background: 'var(--tg-secondary)',
  color: 'var(--tg-text)',
  border: 'none',
  borderRadius: 6,
  fontSize: 11,
  cursor: 'pointer',
} as const;
