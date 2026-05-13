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
  // CRM enrichment (filled when bot has AdMetrics → CRM mapping)
  leads?: number;
  inWork?: number; // в работе (детальный этап)
  scheduled?: number; // оплаченные лиды
  completed?: number;
  cancelled?: number;
  revenue?: number;
  cpl?: number | null; // cost / scheduled
  roi?: number | null; // (revenue - cost) / cost
}

export interface AnalyticsContext {
  days: number;
  totalImpressions: number;
  totalClicks: number;
  totalCost: number;
  avgCtr: number;
  avgCpc: number;
  // CRM totals (only present when bot has CRM-enriched AdMetrics)
  totalLeads?: number;
  totalNew?: number; // status=new + stage не «в работе»
  totalInWork?: number; // status=new + stage «в работе»
  totalScheduled?: number;
  totalCompleted?: number;
  totalCancelled?: number;
  totalRevenue?: number;
  cpl?: number | null;
  roi?: number | null;
  conversionRate?: number; // scheduled / leads, %
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
  const hasCrm = ctx.totalLeads !== undefined && ctx.totalLeads > 0;

  const campaignTable = ctx.campaigns
    .slice(0, 30)
    .map((c) => {
      const base = `  • ${c.campaignName} | ${c.campaignType ?? '?'} | пок ${c.impressions.toLocaleString('ru-RU')} | кл ${c.clicks} | CTR ${c.ctr}% | расход ${c.cost.toLocaleString('ru-RU')}₽`;
      if (c.leads !== undefined && c.leads > 0) {
        return (
          base +
          ` | лидов ${c.leads} | согласовано ${c.scheduled ?? 0} | завершено ${c.completed ?? 0} | выручка ${(c.revenue ?? 0).toLocaleString('ru-RU')}₽ | CPL ${c.cpl !== null && c.cpl !== undefined ? c.cpl + '₽' : '—'} | ROI ${c.roi !== null && c.roi !== undefined ? (c.roi * 100).toFixed(0) + '%' : '—'}`
        );
      }
      return base;
    })
    .join('\n');

  const intro =
    mode === 'analytics'
      ? `Сделай краткий разбор работы кампаний за последние ${ctx.days} дн. для владельца:`
      : `Дай конкретные рекомендации по оптимизации за последние ${ctx.days} дн.:`;

  const crmBlock = hasCrm
    ? `
=== ПРОДАЖИ (из CRM) ===
Лидов: ${ctx.totalLeads}
Согласовано (оплачено): ${ctx.totalScheduled ?? 0}
Завершено (игра прошла): ${ctx.totalCompleted ?? 0}
Отказы: ${ctx.totalCancelled ?? 0}
Выручка: ${(ctx.totalRevenue ?? 0).toLocaleString('ru-RU')} ₽
Конверсия в оплату: ${ctx.conversionRate ?? 0}%
CPL (цена оплаченного лида): ${ctx.cpl !== null && ctx.cpl !== undefined ? ctx.cpl + '₽' : '—'}
ROI: ${ctx.roi !== null && ctx.roi !== undefined ? (ctx.roi * 100).toFixed(0) + '%' : '—'}
`
    : '\n(нет CRM-данных за период)\n';

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
${crmBlock}
=== ПО КАМПАНИЯМ ===
${campaignTable || '  (нет активных кампаний)'}

${mode === 'analytics' ? 'Разбор (опирайся на CPL/ROI/конверсию если данные есть):' : 'Рекомендации (приоритет — по CPL/ROI если есть):'}`;
}
