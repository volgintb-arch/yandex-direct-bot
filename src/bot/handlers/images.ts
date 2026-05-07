import type { SessionContext } from '../middlewares/session.js';
import { syncImagesToDb } from '../../services/yandex-direct/imageads.js';
import { db } from '../../lib/db.js';

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

export async function handleListImages(ctx: SessionContext): Promise<void> {
  const total = await db.yandexImage.count();
  const withDescription = await db.yandexImage.count({ where: { description: { not: null } } });
  const recent = await db.yandexImage.findMany({
    orderBy: { syncedAt: 'desc' },
    take: 8,
  });

  if (total === 0) {
    await ctx.reply(
      'Банк пуст. Отправь фото в чат — оно автоматически добавится в банк, или используй `/syncimages` чтобы подтянуть всё что уже есть в кабинете Директа.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const lines = [
    `🖼 *Банк картинок РСЯ*`,
    `Всего: ${total} · с AI-описанием: ${withDescription}`,
    '',
    ...recent.map(
      (img, i) =>
        `${i + 1}. \`${img.hash.slice(0, 10)}…\` — ${img.description ?? img.name ?? '(без описания)'}`
    ),
    recent.length < total ? `\n_…показано ${recent.length} из ${total}_` : '',
  ];
  await ctx.reply(lines.filter(Boolean).join('\n'), { parse_mode: 'Markdown' });
}
