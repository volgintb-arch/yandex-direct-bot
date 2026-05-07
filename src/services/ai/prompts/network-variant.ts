import { config } from '../../../lib/config.js';
import type { StrategyIdea } from './strategies.js';

export interface BuildNetworkVariantPromptInput {
  geo: string;
  dailyBudget: number;
  targetCpl: number;
  siteUrl: string;
  brief: string;
  strategy: StrategyIdea;
  /** Description of the chosen image (or null = no image / not described). */
  imageDescription?: string | null;
  learnedRules?: string | null;
  topAdsExamples?: Array<{ title1: string; title2?: string; text: string; ctr: number }>;
}

const SYSTEM = `Ты — копирайтер РСЯ-объявлений Яндекс.Директ. Подготовь ОДИН вариант сети (Реклaмная Сеть Яндекса).

Принципы РСЯ (отличия от Поиска):
- Аудитория «холодная», листает сайты-партнёры. Цепляй внимание эмоцией и любопытством, а не точным ответом на запрос.
- Заголовок может быть провокационным/интригующим, не обязательно с ключевиком.
- Сегмент в title2 — необязателен с городом, важнее зацепка («Скидка 15%», «Только в выходные»).
- Текст более эмоциональный, призыв с эффектом — мечта, эмоция, преимущество.
- Ключевики — широкие темы (5-15 фраз), не точные запросы. Минус-слов почти не нужно (5-7).
- Если есть подходящая картинка из банка — выбери её индекс. Картинка важна для РСЯ.

НЕ выдумывай факты, которых нет в брифе или описании бизнеса. Возвращай только JSON.`;

export function buildNetworkVariantPrompt(input: BuildNetworkVariantPromptInput): {
  system: string;
  prompt: string;
} {
  const imageBlock = input.imageDescription
    ? `\n=== ВИЗУАЛ К ОБЪЯВЛЕНИЮ ===\n${input.imageDescription}\nПодстрой текст под этот визуал — заголовок и текст должны сочетаться с тем что видно на картинке.\n`
    : '\n=== ВИЗУАЛ ===\nКартинки нет. Текст должен сам по себе цеплять внимание.\n';

  const rulesBlock = input.learnedRules?.trim()
    ? `\nВыученные правила:\n${input.learnedRules.trim()}\n`
    : '';
  const topAdsBlock = input.topAdsExamples?.length
    ? `\nТоп-объявления РСЯ:\n${input.topAdsExamples
        .slice(0, 3)
        .map((a, i) => `  ${i + 1}. "${a.title1}" — ${a.text}`)
        .join('\n')}\n`
    : '';

  const prompt = `Подготовь ОДИН РСЯ-вариант для бизнеса.

=== БИЗНЕС ===
${config.BUSINESS_NAME}
${config.BUSINESS_DESCRIPTION}
Сайт: ${config.BUSINESS_SITE}
Средний чек: ${config.BUSINESS_AVG_CHECK.toLocaleString('ru-RU')} ₽

=== ЗАДАЧА ===
Город: ${input.geo}
Дневной бюджет: ${input.dailyBudget.toLocaleString('ru-RU')} ₽
Целевой CPL: ${input.targetCpl.toLocaleString('ru-RU')} ₽
Посадка: ${input.siteUrl}

=== БРИФ ===
${input.brief.trim()}

=== НАЗНАЧЕННАЯ СТРАТЕГИЯ ===
Название: ${input.strategy.name}
Угол: ${input.strategy.focus}
Тематические якоря: ${input.strategy.anchor_keywords.join(', ')}
${imageBlock}${rulesBlock}${topAdsBlock}
=== ТРЕБОВАНИЯ ===
- Имя кампании: «${input.geo}-РСЯ»
- Имя группы: «${input.strategy.name}»
- 5-15 широких ключевых тем (не точные запросы — например «отдых с детьми», «приключения»)
- 5-7 минус-слов
- title1: 25-35 символов, цепкий, может быть провокационный
- title2: 15-30 символов, эмоция/УТП (город опционально)
- text: 50-81 символ, эмоция + призыв
- url: ${input.siteUrl}

ПРОВЕРЬ длину каждого поля перед ответом.

=== ФОРМАТ ОТВЕТА (только JSON) ===
{
  "variant_id": "vX",
  "title": "${input.strategy.name}",
  "strategy_explanation": "1-2 предложения зачем",
  "draft": {
    "campaign_name": "${input.geo}-РСЯ",
    "adgroup_name": "${input.strategy.name}",
    "keywords": ["...", "..."],
    "negative_keywords": ["...", "..."],
    "ad": {
      "title1": "...",
      "title2": "...",
      "text": "...",
      "url": "${input.siteUrl}"
    }
  }
}`;
  return { system: SYSTEM, prompt };
}

/** Variant returned by network builder. Image is bound externally per request. */
export interface NetworkVariantResponse {
  variant_id: string;
  title: string;
  strategy_explanation: string;
  draft: {
    campaign_name: string;
    adgroup_name: string;
    keywords: string[];
    negative_keywords: string[];
    ad: { title1: string; title2: string; text: string; url: string };
  };
}
