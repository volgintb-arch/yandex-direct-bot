import { config } from '../../../lib/config.js';

export interface BuildCplPromptInput {
  geo: string;
  dailyBudget: number;
  campaignType: 'search' | 'network';
  brief: string;
  /** Historical CPL data for similar campaigns in this city (if any). */
  history?: Array<{ ad: string; cpl: number; leads: number }>;
}

const SYSTEM = `Ты — аналитик контекстной рекламы. Твоя задача — предложить разумный целевой CPL (стоимость лида) для новой кампании, опираясь на параметры бизнеса, город и историю.

Принципы:
- CPL не может быть выше, чем (средний чек × маржинальность). Для квестов маржинальность ~30-40%, разумная верхняя граница CPL ≈ средний чек / 4.
- Для маленького города (Омск, Барнаул) CPL ниже, чем для крупного (Москва, Краснодар).
- Для РСЯ CPL обычно на 30-50% ниже, чем в Поиске (трафик «холоднее»).
- Если есть история — отталкивайся от неё (медиана, не среднее).

Возвращай только JSON.`;

export function buildCplPrompt(input: BuildCplPromptInput): {
  system: string;
  prompt: string;
} {
  const historyBlock = input.history?.length
    ? `\nИстория за последние 30 дней:\n${input.history
        .slice(0, 10)
        .map((h) => `  • "${h.ad}" — CPL ${h.cpl}₽, ${h.leads} лидов`)
        .join('\n')}\nМедианный CPL по истории: ${median(input.history.map((h) => h.cpl))}₽`
    : '\nИсторических данных по этому городу нет — оцени по рынку.';

  const prompt = `Предложи целевой CPL для новой кампании.

Бизнес: ${config.BUSINESS_NAME}
Описание: ${config.BUSINESS_DESCRIPTION}
Средний чек: ${config.BUSINESS_AVG_CHECK.toLocaleString('ru-RU')} ₽

Параметры кампании:
  Город: ${input.geo}
  Тип: ${input.campaignType === 'search' ? 'Поиск' : 'РСЯ'}
  Дневной бюджет: ${input.dailyBudget.toLocaleString('ru-RU')} ₽

Бриф:
${input.brief.trim()}
${historyBlock}

Формат ответа (только JSON):
{ "suggested_cpl": число_в_рублях, "reasoning": "1-2 предложения почему именно столько" }`;

  return { system: SYSTEM, prompt };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface CplSuggestion {
  suggested_cpl: number;
  reasoning: string;
}
