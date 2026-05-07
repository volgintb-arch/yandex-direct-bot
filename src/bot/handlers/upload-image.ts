import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { uploadAdImage } from '../../services/yandex-direct/imageads.js';
import { describeImage } from '../../services/ai/vision.js';
import { config } from '../../lib/config.js';

const TG_FILE_API = 'https://api.telegram.org';

/**
 * Telegram photo handler — downloads the largest size, uploads to Direct,
 * stores in YandexImage, optionally generates an AI description.
 */
export async function handleUploadImage(ctx: SessionContext): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  // Largest size is the last item.
  const largest = photos[photos.length - 1]!;
  const caption = ctx.message?.caption?.trim();

  const status = await ctx.reply('📥 Загружаю картинку в банк...');
  try {
    // 1. Download from Telegram
    const fileInfo = await ctx.api.getFile(largest.file_id);
    if (!fileInfo.file_path) throw new Error('Telegram getFile returned no file_path');
    const fileUrl = `${TG_FILE_API}/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`Telegram download HTTP ${fileRes.status}`);
    const arrayBuf = await fileRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString('base64');
    const mimeType = guessMime(fileInfo.file_path);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '☁️ Загружаю в Яндекс.Директ...'
    );
    const hash = await uploadAdImage({
      imageBase64: base64,
      name: caption ? caption.slice(0, 50) : `tg-${Date.now()}`,
    });

    // 2. Save base record (so we have hash even if Vision fails)
    const created = await db.yandexImage.upsert({
      where: { hash },
      create: {
        hash,
        name: caption ?? null,
        format: mimeType.split('/')[1]?.toUpperCase() ?? null,
        uploadedBy: ctx.authUser.telegramId,
      },
      update: {},
    });

    // 3. Best-effort Vision description
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '🧠 Прошу ИИ описать картинку...'
    );
    let description = caption ?? null;
    let tags: string[] = [];
    const vision = await describeImage(base64, mimeType);
    if (vision) {
      description = vision.description;
      tags = vision.tags;
      await db.yandexImage.update({
        where: { hash },
        data: { description, tags },
      });
    }

    const lines = [
      '✅ *Картинка добавлена в банк*',
      `🔑 hash: \`${hash.slice(0, 12)}…\``,
      caption ? `📝 Подпись: _${caption}_` : '',
      vision ? `🧠 Описание ИИ: _${vision.description}_` : '_Без AI-описания_',
      tags.length ? `🏷 Теги: ${tags.map((t) => `\`${t}\``).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, lines, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'image upload failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не удалось загрузить картинку: ${msg}`
    );
  }
}

function guessMime(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
