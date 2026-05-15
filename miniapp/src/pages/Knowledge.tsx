import { useEffect, useState } from 'react';
import { api, type KnowledgeEntry } from '../lib/api.js';

const TYPE_LABEL: Record<string, string> = {
  learned_rules: '📜 Выученные правила',
  top_ad: '🏆 Топ-объявление',
  failure_pattern: '💀 Что не работает',
  insight: '💡 Инсайт',
};

export default function Knowledge() {
  const [items, setItems] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .knowledge()
      .then((r) => setItems(r.entries))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1>🧠 База знаний ИИ</h1>
      {loading && <div className="loader">Загрузка...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          Знаний пока нет. Запусти <code>/learn</code> в боте после того как накопится трафик.
        </div>
      )}
      {items.map((e) => {
        const data = e.data as Record<string, unknown>;
        const rules = (data.rules as string) ?? null;
        const title1 = (data.title1 as string) ?? null;
        return (
          <div className="campaign-card" key={e.id}>
            <div className="title">
              {TYPE_LABEL[e.type] ?? e.type} · {e.scope}
              {e.city ? ` · ${e.city}` : ''}
            </div>
            <div className="meta">
              {new Date(e.createdAt).toLocaleString('ru-RU')}
            </div>
            {rules && (
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 13 }}>
                {rules.slice(0, 600)}
                {rules.length > 600 ? '…' : ''}
              </div>
            )}
            {title1 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>"{title1}"</strong>
                {data.text ? (
                  <div className="muted">{String(data.text).slice(0, 100)}</div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
