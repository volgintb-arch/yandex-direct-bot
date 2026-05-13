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
      const baseLine = `${i + 1}. *${escapeMd(c.campaignName)}*\n     ${c.clicks} кл · CTR ${ctr} · CPC ${cpc} · расход *${c.cost.toLocaleString('ru-RU')}₽*`;
      if (c.leads !== undefined && c.leads > 0) {
        const cpl = c.cpl !== null && c.cpl !== undefined ? `${c.cpl}₽` : '—';
        const roi =
          c.roi !== null && c.roi !== undefined ? `${(c.roi * 100).toFixed(0)}%` : '—';
        return (
          baseLine +
          `\n     лидов ${c.leads} · оплачено ${c.scheduled ?? 0} · выручка ${(c.revenue ?? 0).toLocaleString('ru-RU')}₽ · CPL ${cpl} · ROI ${roi}`
        );
      }
      return baseLine;
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
        `📭 Нет активных кампаний или нет данных за ${days} дн.`
      );
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '🧠 ИИ анализирует цифры...'
    );
    const summary = await summarizeAnalytics(data);

    const hasCrm = (data.totalLeads ?? 0) > 0;
    const crmBlock = hasCrm
      ? [
          '',
          '*📈 По воронке CRM (yandex):*',
          `📥 Лидов всего: *${data.totalLeads}*`,
          `🆕 Новые: *${data.totalNew ?? 0}*  ·  🔄 В работе: *${data.totalInWork ?? 0}*`,
          `✅ Согласовано / оплачено: *${data.totalScheduled ?? 0}*  ·  🎉 Завершено: *${data.totalCompleted ?? 0}*`,
          `❌ Отказы: *${data.totalCancelled ?? 0}*  ·  📊 Конверсия в оплату: *${data.conversionRate ?? 0}%*`,
          `💵 Выручка: *${(data.totalRevenue ?? 0).toLocaleString('ru-RU')}₽*`,
          `💸 CPL: *${data.cpl !== null && data.cpl !== undefined ? data.cpl + '₽' : '—'}*  ·  📈 ROI: *${data.roi !== null && data.roi !== undefined ? (data.roi * 100).toFixed(0) + '%' : '—'}*`,
        ]
      : ['', '_⚠️ CRM-данных пока нет — запусти `/sync` и подожди появления первых лидов._'];

    const lines = [
      `📊 *Аналитика за ${days} дн.* _(только активные кампании)_`,
      '',
      `Кампаний: *${data.campaigns.length}*  ·  Показов: *${data.totalImpressions.toLocaleString('ru-RU')}*`,
      `Кликов: *${data.totalClicks.toLocaleString('ru-RU')}*  ·  CTR: *${data.avgCtr}%*`,
      `Расход: *${data.totalCost.toLocaleString('ru-RU')}₽*  ·  Сред. CPC: *${data.avgCpc}₽*`,
      ...crmBlock,
      '',
      '*🏆 Топ-5 кампаний по расходу:*',
      formatTopCampaigns(data.campaigns, 5),
      '',
      summary ? '*🧠 Разбор от ИИ:*' : '',
      summary || '_ИИ отказался разбирать. Цифры выше актуальны._',
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
        `📭 Нет активных кампаний для оптимизации.`
      );
      return;
    }

    const tips = await suggestOptimizations(data);
    const lines = [
      `*⚡ Рекомендации по оптимизации (${days} дн.)* _(только активные)_`,
      '',
      tips || '_ИИ отказался давать рекомендации. Попробуй позже._',
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
