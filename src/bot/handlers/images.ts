import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { syncImagesToDb, deleteAdImage } from '../../services/yandex-direct/imageads.js';
import { imageManageKeyboard } from '../keyboards.js';

export async function handleSyncImages(ctx: SessionContext): Promise<void> {
  const status = await ctx.reply('🔄 Синхронизирую банк картинок из Яндекс.Директ...');
  try {
    const r = await syncImagesToDb();
    const total = await db.yandexImage.count();
    const withDescription = await db.yandexImage.count({ where: { description: { not: null } } });
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      [
        '✅ Банк картинок обновлён',
        `📦 Всего в кабинете: ${r.synced}`,
        `🆕 Добавлено новых: ${r.new}`,
        `📚 Локально: ${total} (с AI-описанием: ${withDescription})`,
      ].join('\n')
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не удалось синхронизировать: ${msg}`
    );
  }
}

/** /images — list each image as a separate message with manage buttons. */
export async function handleListImages(ctx: SessionContext): Promise<void> {
  const total = await db.yandexImage.count();
  if (total === 0) {
    await ctx.reply(
      'Банк пуст. Отправь фото *файлом* в чат — оно автоматически добавится в банк, или используй `/syncimages` чтобы подтянуть всё что уже есть в кабинете Директа.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const images = await db.yandexImage.findMany({
    orderBy: { syncedAt: 'desc' },
    take: 15,
  });

  await ctx.reply(`🖼 *Банк картинок: ${total}* (показываю последние ${images.length})`, {
    parse_mode: 'Markdown',
  });

  for (const img of images) {
    const lines = [
      img.description ?? img.name ?? `_(без описания)_`,
      `\`hash: ${img.hash.slice(0, 20)}…\``,
      img.format ? `формат: ${img.format}` : '',
      img.tags.length ? `теги: ${img.tags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      if (img.url) {
        await ctx.replyWithPhoto(img.url, {
          caption: lines,
          parse_mode: 'Markdown',
          reply_markup: imageManageKeyboard(img.hash),
        });
      } else {
        await ctx.reply(lines, {
          parse_mode: 'Markdown',
          reply_markup: imageManageKeyboard(img.hash),
        });
      }
    } catch (err) {
      logger.warn({ err, hash: img.hash }, 'failed to render image card, falling back to text');
      await ctx.reply(lines, {
        parse_mode: 'Markdown',
        reply_markup: imageManageKeyboard(img.hash),
      });
    }
  }
}

/** Delete an image from both Direct and local DB. */
export async function handleDeleteImage(ctx: SessionContext, hash: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: 'Удаляю...' });
  try {
    await deleteAdImage(hash);
    await db.yandexImage.delete({ where: { hash } }).catch(() => {});
    await ctx.editMessageCaption({
      caption: '🗑 _Картинка удалена_',
      parse_mode: 'Markdown',
    }).catch(async () => {
      await ctx.editMessageText('🗑 _Картинка удалена_', { parse_mode: 'Markdown' }).catch(() => {});
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ Не удалось удалить: ${msg}`);
  }
}

/** Start renaming an image — set state, ask for new name. */
export async function handleRenameImage(ctx: SessionContext, hash: string): Promise<void> {
  ctx.session.state = 'awaiting_image_caption';
  ctx.session.context = { ...ctx.session.context, renamingImageHash: hash };
  await ctx.saveSession();
  await ctx.answerCallbackQuery();
  await ctx.reply('✏️ Введи новое описание картинки одним сообщением:');
}

/** Apply rename text after user replies. */
export async function handleRenameText(ctx: SessionContext, text: string): Promise<void> {
  const hash = ctx.session.context.renamingImageHash as string | undefined;
  if (!hash) {
    ctx.session.state = 'idle';
    await ctx.saveSession();
    return;
  }
  await db.yandexImage.update({
    where: { hash },
    data: { description: text.trim().slice(0, 500), name: text.trim().slice(0, 100) },
  });
  ctx.session.state = 'idle';
  ctx.session.context.renamingImageHash = undefined;
  await ctx.saveSession();
  await ctx.reply(`✅ Описание обновлено: _${text.trim().slice(0, 100)}_`, { parse_mode: 'Markdown' });
}
