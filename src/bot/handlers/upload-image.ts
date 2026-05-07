import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { uploadAdImage } from '../../services/yandex-direct/imageads.js';
import { prepareForDirect } from '../../services/yandex-direct/image-prepare.js';
import { describeImage } from '../../services/ai/vision.js';
import { config } from '../../lib/config.js';

const TG_FILE_API = 'https://api.telegram.org';

/**
 * Telegram photo handler. Photos sent inline are compressed by Telegram and
 * Direct often rejects them by size. We still try, but recommend documents.
 */
export async function handleUploadImage(ctx: SessionContext): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;
  const largest = photos[photos.length - 1]!;
  const caption = ctx.message?.caption?.trim();
  await processUploadedFile(ctx, largest.file_id, caption, true);
}

/**
 * Telegram document handler — for images sent as files (no compression).
 * Only handles image/* MIME types; other files are ignored.
 */
export async function handleUploadDocument(ctx: SessionContext): Promise<void> {
  const doc = ctx.message?.document;
  if (!doc) return;
  const mime = doc.mime_type ?? '';
  if (!mime.startsWith('image/')) {
    // Not an image — ignore silently (might be other workflows later).
    return;
  }
  if (mime === 'image/webp' || mime === 'image/heic' || mime === 'image/heif') {
    await ctx.reply(
      `⚠️ Формат \`${mime}\` не поддерживается Яндекс.Директ. Пришли JPG, PNG или GIF.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  const caption = ctx.message?.caption?.trim();
  await processUploadedFile(ctx, doc.file_id, caption, false);
}

async function processUploadedFile(
  ctx: SessionContext,
  fileId: string,
  caption: string | undefined,
  fromCompressedPhoto: boolean
): Promise<void> {
  const status = await ctx.reply('📥 Скачиваю картинку...');
  try {
    const fileInfo = await ctx.api.getFile(fileId);
    if (!fileInfo.file_path) throw new Error('Telegram getFile returned no file_path');
    const fileUrl = `${TG_FILE_API}/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`Telegram download HTTP ${fileRes.status}`);
    const rawBuf = Buffer.from(await fileRes.arrayBuffer());

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '✂️ Подгоняю размер под требования Директа...'
    );
    const prepared = await prepareForDirect(rawBuf);
    const base64 = prepared.buffer.toString('base64');
    const mimeType = 'image/jpeg';

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `☁️ Загружаю в Яндекс.Директ (${prepared.width}×${prepared.height}, ${prepared.target.name})...`
    );
    const hash = await uploadAdImage({
      imageBase64: base64,
      name: caption ? caption.slice(0, 50) : `tg-${Date.now()}`,
    });

    await db.yandexImage.upsert({
      where: { hash },
      create: {
        hash,
        name: caption ?? null,
        format: mimeType.split('/')[1]?.toUpperCase() ?? null,
        uploadedBy: ctx.authUser.telegramId,
      },
      update: {},
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '🧠 Прошу ИИ описать картинку...'
    );
    let description: string | null = caption ?? null;
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

    if (ctx.session.state === 'awaiting_image_for_network') {
      ctx.session.context = {
        ...ctx.session.context,
        imageHash: hash,
        imageDescription: vision?.description ?? caption ?? null,
      };
      ctx.session.state = 'idle';
      await ctx.saveSession();
      const { proceedAfterImage } = await import('./callbacks.js');
      await proceedAfterImage(ctx);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, fromCompressedPhoto }, 'image upload failed');

    const tail = fromCompressedPhoto
      ? '\n\n💡 *Подсказка:* Telegram сжимает фото. Пришли картинку *как файл* (📎 → Файл) — Direct примет оригинал.'
      : '';
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не удалось загрузить: ${msg}${tail}`,
      { parse_mode: 'Markdown' }
    );
  }
}

function guessMime(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
