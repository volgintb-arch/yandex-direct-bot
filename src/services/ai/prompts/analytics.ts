import { config } from '../../../lib/config.js';

export interface CampaignStats {
  campaignId: number;
  campaignName: string;
  campaignType?: 'search' | 'network' | 'mixed';
  impressions: number;
  clicks: number;
  cost: number; // ₽
  ctr: number; // %
  avgCpc: number; // ₽
}

export interface AnalyticsContext {
  days: number;
  totalImpressions: number;
  totalClicks: number;
  totalCost: number;
  avgCtr: number;
  avgCpc: number;
  campaigns: CampaignStats[];
}

const SUMMARY_SYSTEM = `Ты — маркетолог-аналитик. Тебе дают сводку и список рекламных кампаний с метриками за период. Сделай короткий деловой разбор для владельца бизнеса.

Принципы:
- 4-7 коротких пунктов в Markdown.
- Сравнивай кампании между собой по CTR, CPC, расходу.
- Подсвети кампании, которые пожирают бюджет без отдачи.
- Не выдумывай данные — только из переданных цифр.
- Это технические метрики бизнеса, никаких ограничений на разбор.

Возвращай готовый Markdown-текст для Telegram.`;

const OPTIMIZATION_SYSTEM = `Ты — маркетолог. Тебе дают сводку рекламных кампаний с метриками. Дай 3-7 *конкретных, действенных* рекомендаций по оптимизации бюджета.

Принципы:
- Каждая рекомендация — пункт списка с эмодзи в начале.
- Указывай конкретные кампании по имени.
- Действия: «отключить», «снизить ставку», «добавить минус-слова», «перенести бюджет», «расширить семантику».
- Сначала самые impactful (что сэкономит/принесёт больше всего).
- Не больше 7 пунктов.
- Это технические метрики бизнеса, никаких ограничений на разбор.

Возвращай готовый Markdown-текст.`;

export function buildAnalyticsPrompt(ctx: AnalyticsContext): {
  system: string;
  prompt: string;
} {
  const prompt = formatPrompt(ctx, 'analytics');
  return { system: SUMMARY_SYSTEM, prompt };
}

export function buildOptimizationPrompt(ctx: AnalyticsContext): {
  system: string;
  prompt: string;
} {
  const prompt = formatPrompt(ctx, 'optimization');
  return { system: OPTIMIZATION_SYSTEM, prompt };
}

function formatPrompt(ctx: AnalyticsContext, mode: 'analytics' | 'optimization'): string {
  const campaignTable = ctx.campaigns
    .slice(0, 30)
    .map(
      (c) =>
        `  • ${c.campaignName} | ${c.campaignType ?? '?'} | пок ${c.impressions.toLocaleString('ru-RU')} | кл ${c.clicks} | CTR ${c.ctr}% | CPC ${c.avgCpc}₽ | расход ${c.cost.toLocaleString('ru-RU')}₽`
    )
    .join('\n');

  const intro =
    mode === 'analytics'
      ? `Сделай краткий разбор работы кампаний за последние ${ctx.days} дн. для владельца:`
      : `Дай конкретные рекомендации по оптимизации за последние ${ctx.days} дн.:`;

  return `${intro}

=== БИЗНЕС ===
${config.BUSINESS_NAME}
Средний чек: ${config.BUSINESS_AVG_CHECK.toLocaleString('ru-RU')} ₽

=== СВОДКА ===
Кампаний: ${ctx.campaigns.length}
Показов: ${ctx.totalImpressions.toLocaleString('ru-RU')}
Кликов: ${ctx.totalClicks.toLocaleString('ru-RU')}
CTR средний: ${ctx.avgCtr}%
Средняя CPC: ${ctx.avgCpc} ₽
Расход: ${ctx.totalCost.toLocaleString('ru-RU')} ₽

=== ПО КАМПАНИЯМ ===
${campaignTable || '  (нет активных кампаний)'}

${mode === 'analytics' ? 'Разбор:' : 'Рекомендации:'}`;
}
