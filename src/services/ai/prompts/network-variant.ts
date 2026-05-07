import { config } from '../../../lib/config.js';
import type { StrategyIdea } from './strategies.js';

export interface BuildNetworkVariantPromptInput {
  geo: string;
  dailyBudget: number;
  targetCpl: number;
  siteUrl: string;
  brief: string;
  strategy: StrategyIdea;
  /** Optional: image candidates the AI can pick from (description-based). */
  imageCandidates?: Array<{ index: number; description: string | null }>;
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
  const imagesBlock = input.imageCandidates?.length
    ? `\n=== КАРТИНКИ ИЗ БАНКА (выбери индекс или -1 если ни одна не подходит) ===\n${input.imageCandidates
        .map((img) => `  [${img.index}] ${img.description ?? '(без описания)'}`)
        .join('\n')}\n`
    : '\n=== КАРТИНКИ ===\nБанк пуст. Используй selected_image_index = -1.\n';

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
${imagesBlock}${rulesBlock}${topAdsBlock}
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
  "selected_image_index": <индекс из банка или -1>,
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

/** Variant returned by network builder; extends search variant with image choice. */
export interface NetworkVariantResponse {
  variant_id: string;
  title: string;
  strategy_explanation: string;
  selected_image_index: number;
  draft: {
    campaign_name: string;
    adgroup_name: string;
    keywords: string[];
    negative_keywords: string[];
    ad: { title1: string; title2: string; text: string; url: string };
  };
}
