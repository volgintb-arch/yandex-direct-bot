import type { SessionContext } from '../middlewares/session.js';
import { syncLeads } from '../../jobs/sync-leads.js';
import { runDailyLearning } from '../../jobs/daily-learning.js';
import { logger } from '../../lib/logger.js';

export async function handleSync(ctx: SessionContext): Promise<void> {
  const status = await ctx.reply('🔄 Запускаю синхронизацию лидов с CRM + расхода из Direct...');
  try {
    const r = await syncLeads();
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      [
        '✅ *Sync готов*',
        '',
        `🪟 Окно: ${r.windowFrom.slice(0, 16)} → ${r.windowTo.slice(0, 16)}`,
        `📥 Лидов из CRM: *${r.leadsFetched}*`,
        `🔗 yclid обновлено: *${r.yclidsUpserted}*`,
        `📊 AdMetrics строк: *${r.metricsUpserted}*`,
        r.unmappableLeads > 0
          ? `⚠️ Лидов без ad\\_id: ${r.unmappableLeads}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, '/sync failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Sync упал: ${msg}`
    );
  }
}

export async function handleLearn(ctx: SessionContext): Promise<void> {
  const status = await ctx.reply('🧠 Запускаю обучение на 30-дневных данных (Поиск + РСЯ)...');
  try {
    const { search, network } = await runDailyLearning();
    const blocks: string[] = ['✅ *Обучение завершено*', ''];

    if (search) {
      blocks.push(
        `*🔍 Поиск* — топ ${search.topCount}, провалов ${search.bottomCount}`,
        '',
        search.rules.slice(0, 1500),
        ''
      );
    } else {
      blocks.push('*🔍 Поиск* — _данных пока недостаточно_', '');
    }

    if (network) {
      blocks.push(
        `*📡 РСЯ* — топ ${network.topCount}, провалов ${network.bottomCount}`,
        '',
        network.rules.slice(0, 1500)
      );
    } else {
      blocks.push('*📡 РСЯ* — _данных пока недостаточно_');
    }

    const text = blocks.join('\n');
    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, text, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, '/learn failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Обучение упало: ${msg}`
    );
  }
}
