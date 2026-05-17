import { config } from '../../../lib/config.js';
import type { StrategyIdea } from './strategies.js';

export interface BuildSearchVariantPromptInput {
  geo: string;
  dailyBudget: number;
  targetCpl: number;
  siteUrl: string;
  brief: string;
  strategy: StrategyIdea;
  wordstatTop: Array<{ phrase: string; count: number }>;
  learnedRules?: string | null;
  topAdsExamples?: Array<{ title1: string; title2?: string; text: string; ctr: number }>;
  documents?: string | null;
}

const SYSTEM = `Ты — копирайтер контекстной рекламы Яндекс.Директ. Тебе дают задачу + конкретную стратегию. Подготовь ОДИН готовый вариант: имена, ключевики, минус-слова, объявление.

Принципы:
- НЕ выдумывай факты, которых нет в брифе или в описании бизнеса.
- Соблюдай лимиты Директа по символам.
- Title2 ОБЯЗАТЕЛЬНО включает название города.
- Опирайся на Wordstat и anchor_keywords стратегии.

Возвращай только JSON, без markdown.`;

export function buildSearchVariantPrompt(input: BuildSearchVariantPromptInput): {
  system: string;
  prompt: string;
} {
  const wordstatBlock = input.wordstatTop.length
    ? input.wordstatTop
        .slice(0, 25)
        .map((r) => `  • ${r.phrase} — ${r.count.toLocaleString('ru-RU')}`)
        .join('\n')
    : '  (Wordstat пуст, опирайся на бриф и anchor_keywords)';

  const rulesBlock = input.learnedRules?.trim()
    ? `\nВыученные правила (что работает):\n${input.learnedRules.trim()}\n`
    : '';
  const topAdsBlock = input.topAdsExamples?.length
    ? `\nПримеры топовых объявлений (CTR > 5%):\n${input.topAdsExamples
        .slice(0, 3)
        .map((a, i) => `  ${i + 1}. "${a.title1}" | "${a.title2 ?? '—'}" — ${a.text}`)
        .join('\n')}\n`
    : '';

  const docsBlock = input.documents?.trim()
    ? `\nДОКУМЕНТЫ КЛИЕНТА (брифы, оферы, описания):\n${input.documents.trim()}\n`
    : '';

  const prompt = `Подготовь ОДИН вариант поисковой кампании Яндекс.Директ.

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
Опорные ключи: ${input.strategy.anchor_keywords.join(', ')}

=== ТОП-ЗАПРОСЫ ИЗ WORDSTAT ===
${wordstatBlock}
${rulesBlock}${topAdsBlock}${docsBlock}
=== ТРЕБОВАНИЯ ===
- Имя кампании: «${input.geo}-Поиск»
- Имя группы: используй название стратегии «${input.strategy.name}» (можно адаптировать)
- Минимум 20 ключей (используй anchor_keywords + Wordstat + синонимы)
- Минимум 15 минус-слов (мусор: бесплатно, скачать, играть онлайн, видео, форум, отзывы, работа, вакансии и т.п.)
- title1: ЖЁСТКО 25-35 символов с пробелами. Считай буквы! Не превышай 35. Без знаков препинания в конце.
- title2: ЖЁСТКО 15-30 символов с пробелами. Обязательно содержит слово «${input.geo}».
- text: ЖЁСТКО 50-81 символ с пробелами. Призыв к действию + УТП.

ПРОВЕРЬ длину каждого поля перед ответом — Яндекс Директ отклонит превышение.
- url: ${input.siteUrl}

=== ФОРМАТ ОТВЕТА (только JSON) ===
{
  "variant_id": "vX",
  "title": "${input.strategy.name}",
  "strategy_explanation": "1-2 предложения зачем",
  "draft": {
    "campaign_name": "${input.geo}-Поиск",
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
