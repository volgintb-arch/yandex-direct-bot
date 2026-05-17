import { useEffect, useRef, useState } from 'react';
import { api, type ImageEntry } from '../lib/api.js';

interface Props {
  value: string | null;          // selected image hash
  onChange: (hash: string | null) => void;
}

/**
 * РСЯ image picker — upload new (file input → base64) or pick from bank.
 * Hidden until you switch the type to network in the parent form.
 */
export default function ImagePicker({ value, onChange }: Props) {
  const [bank, setBank] = useState<ImageEntry[]>([]);
  const [mode, setMode] = useState<'none' | 'upload' | 'bank'>('none');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.images().then((r) => setBank(r.images)).catch(() => {});
  }, []);

  async function onFileChange(file: File) {
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
      });
      const r = await api.uploadImage(dataUrl, file.name.replace(/\.[^.]+$/, ''));
      onChange(r.hash);
      // Refresh bank
      api.images().then((rr) => setBank(rr.images)).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const selected = bank.find((b) => b.hash === value);

  return (
    <div style={{ marginTop: 16 }}>
      <label className="muted">📷 Картинка (для РСЯ обязательно)</label>
      <div
        className="muted"
        style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}
      >
        JPG/PNG/GIF, мин. 450×450 px, до 10 МБ.
        <br />
        Автоматически обрежется в широкоформат 1080×608 (16:9).
      </div>

      {selected && (
        <div
          style={{
            marginTop: 8,
            padding: 10,
            background: 'var(--tg-secondary)',
            borderRadius: 8,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          {selected.url && (
            <img src={selected.url} alt="" style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4 }} />
          )}
          <div style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <div>{selected.description ?? selected.name ?? selected.hash.slice(0, 12)}</div>
            <div className="muted" style={{ fontSize: 10 }}>✅ выбрано</div>
          </div>
          <button
            onClick={() => onChange(null)}
            style={{
              padding: '4px 10px', background: '#ef4444', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="period-switch" style={{ marginTop: 8 }}>
        <button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode(mode === 'upload' ? 'none' : 'upload')}>
          📤 Загрузить
        </button>
        <button className={mode === 'bank' ? 'active' : ''} onClick={() => setMode(mode === 'bank' ? 'none' : 'bank')}>
          🗂 Из банка ({bank.length})
        </button>
        <button onClick={() => { onChange(null); setMode('none'); }}>➡️ Без</button>
      </div>

      {mode === 'upload' && (
        <div style={{ marginTop: 8 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChange(f); }}
            disabled={uploading}
            style={{
              width: '100%', padding: 10,
              background: 'var(--tg-secondary)', color: 'var(--tg-text)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
            }}
          />
          {uploading && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>⏳ Загружаю в Direct...</div>}
          {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
        </div>
      )}

      {mode === 'bank' && (
        <div style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
          {bank.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Банк пуст. Загрузи через 📤</div>}
          {bank.map((img) => (
            <div
              key={img.hash}
              onClick={() => { onChange(img.hash); setMode('none'); }}
              style={{
                marginTop: 6, padding: 8, cursor: 'pointer',
                background: img.hash === value ? 'var(--tg-button)' : 'var(--tg-secondary)',
                color: img.hash === value ? 'var(--tg-button-text)' : 'var(--tg-text)',
                borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12,
              }}
            >
              {img.url && <img src={img.url} alt="" style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 3 }} />}
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {img.description ?? img.name ?? img.hash.slice(0, 16)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
