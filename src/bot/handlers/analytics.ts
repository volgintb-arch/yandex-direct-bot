import { InlineKeyboard } from 'grammy';
import type { SessionContext } from '../middlewares/session.js';
import {
  loadAnalyticsContext,
  summarizeAnalytics,
  suggestOptimizations,
} from '../../services/ai/analytics-builder.js';
import { logger } from '../../lib/logger.js';
import { escapeMd } from '../format.js';
import type { CampaignStats } from '../../services/ai/prompts/analytics.js';

function formatTopCampaigns(campaigns: CampaignStats[], take = 5): string {
  return campaigns
    .slice(0, take)
    .map((c, i) => {
      const ctr = `${c.ctr}%`;
      const cpc = c.avgCpc > 0 ? `${c.avgCpc}₽` : '—';
      return `${i + 1}. *${escapeMd(c.campaignName)}*\n     ${c.clicks} кл · CTR ${ctr} · CPC ${cpc} · расход *${c.cost.toLocaleString('ru-RU')}₽*`;
    })
    .join('\n');
}

function actionsKeyboard(days: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔄 Обновить', `analytics_refresh|${days}`)
    .text('⚡ Оптимизация', `analytics_optimize|${days}`)
    .row()
    .text('7 дн', 'analytics_period|7')
    .text('14 дн', 'analytics_period|14')
    .text('30 дн', 'analytics_period|30');
}

export async function handleAnalytics(ctx: SessionContext, days = 7): Promise<void> {
  const status = await ctx.reply(`⏳ Загружаю отчёт за ${days} дней...`);
  try {
    const data = await loadAnalyticsContext(days);
    if (!data) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        status.message_id,
        `📭 За ${days} дней нет данных по кампаниям.`
      );
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '🧠 ИИ анализирует цифры...'
    );
    const summary = await summarizeAnalytics(data);

    const lines = [
      `📊 *Аналитика за ${days} дн.*`,
      '',
      `Кампаний: *${data.campaigns.length}*  ·  Показов: *${data.totalImpressions.toLocaleString('ru-RU')}*`,
      `Кликов: *${data.totalClicks.toLocaleString('ru-RU')}*  ·  CTR: *${data.avgCtr}%*`,
      `Расход: *${data.totalCost.toLocaleString('ru-RU')}₽*  ·  Сред. CPC: *${data.avgCpc}₽*`,
      '',
      '*🏆 Топ-5 кампаний по расходу:*',
      formatTopCampaigns(data.campaigns, 5),
      '',
      summary ? '*🧠 Разбор от ИИ:*' : '',
      summary || '_ИИ отказался разбирать (фильтр Яндекс GPT). Цифры выше актуальны._',
    ]
      .filter(Boolean)
      .join('\n');

    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, lines, {
      parse_mode: 'Markdown',
      reply_markup: actionsKeyboard(days),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'analytics failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не удалось собрать аналитику: ${msg}`
    );
  }
}

export async function handleOptimization(ctx: SessionContext, days = 7): Promise<void> {
  const status = await ctx.reply(`⏳ Готовлю рекомендации по оптимизации (${days} дн.)...`);
  try {
    const data = await loadAnalyticsContext(days);
    if (!data) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        status.message_id,
        `📭 За ${days} дней нет данных. Сначала запусти кампании.`
      );
      return;
    }

    const tips = await suggestOptimizations(data);
    const lines = [
      `*⚡ Рекомендации по оптимизации (${days} дн.)*`,
      '',
      tips || '_ИИ отказался давать рекомендации (фильтр Яндекс GPT). Попробуй позже или используй ручную аналитику._',
    ].join('\n');

    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, lines, {
      parse_mode: 'Markdown',
      reply_markup: actionsKeyboard(days),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'optimization failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не удалось подготовить рекомендации: ${msg}`
    );
  }
}
