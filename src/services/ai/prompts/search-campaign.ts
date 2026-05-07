import { config } from '../../../lib/config.js';

export interface BuildSearchPromptInput {
  geo: string;
  dailyBudget: number;
  targetCpl: number;
  siteUrl: string;
  brief: string;
  wordstatTop: Array<{ phrase: string; count: number }>;
  learnedRules?: string | null;
  topAdsExamples?: Array<{ title1: string; title2?: string; text: string; ctr: number }>;
  failurePatterns?: string | null;
}

const SYSTEM = `Ты — опытный специалист по контекстной рекламе в Яндекс.Директ с 8+ лет практики. Твоя специализация — кампании для региональных квест-проектов и развлекательного бизнеса. Ты знаешь, как писать продающие, цепкие заголовки в рамках лимитов Директа.

Принципы:
- НЕ выдумывай факты, которых нет в брифе или в описании бизнеса. Используй только факты, которые тебе дали.
- Если бриф говорит «скидка 15%» — пиши «Скидка 15%», не «50%».
- Если бриф не упоминает «детей» — не пиши «для детей».
- Каждый вариант должен реально отличаться по стратегии, а не быть перефразировкой соседнего.
- Соблюдай лимиты Директа по символам (с пробелами, без знаков препинания в конце).
- Title2 ОБЯЗАТЕЛЬНО включает название города.

Возвращай ТОЛЬКО валидный JSON по схеме. Никакого markdown, комментариев, пояснений.`;

export function buildSearchPrompt(input: BuildSearchPromptInput): {
  system: string;
  prompt: string;
} {
  const wordstatBlock = input.wordstatTop.length
    ? input.wordstatTop
        .slice(0, 30)
        .map((r) => `  • ${r.phrase} — ${r.count.toLocaleString('ru-RU')} показов/мес`)
        .join('\n')
    : '  (Wordstat не дал данных, опирайся на здравый смысл и бриф)';

  const rulesBlock = input.learnedRules?.trim()
    ? `\n=== ВЫУЧЕННЫЕ ПРАВИЛА (что работает у нас) ===\n${input.learnedRules.trim()}\n`
    : '';

  const topAdsBlock = input.topAdsExamples?.length
    ? `\n=== ПРИМЕРЫ ТОПОВЫХ ОБЪЯВЛЕНИЙ (CTR > 5%) ===\n${input.topAdsExamples
        .slice(0, 5)
        .map(
          (a, i) =>
            `  ${i + 1}. "${a.title1}" | "${a.title2 ?? '—'}"\n     ${a.text} (CTR ${a.ctr}%)`
        )
        .join('\n')}\n`
    : '';

  const failBlock = input.failurePatterns?.trim()
    ? `\n=== ЧТО НЕ РАБОТАЛО У НАС (избегай) ===\n${input.failurePatterns.trim()}\n`
    : '';

  const prompt = `Создай 3 варианта поисковой кампании Яндекс.Директ для бизнеса.

=== БИЗНЕС ===
${config.BUSINESS_NAME}
${config.BUSINESS_DESCRIPTION}
Сайт: ${config.BUSINESS_SITE}
Средний чек: ${config.BUSINESS_AVG_CHECK.toLocaleString('ru-RU')} ₽

=== ЗАДАЧА ===
Город: ${input.geo}
Дневной бюджет: ${input.dailyBudget.toLocaleString('ru-RU')} ₽
Целевой CPL (стоимость лида): ${input.targetCpl.toLocaleString('ru-RU')} ₽
Посадочная страница: ${input.siteUrl}

=== БРИФ ОТ ЗАКАЗЧИКА ===
${input.brief.trim()}

=== ТОП-ЗАПРОСЫ ИЗ WORDSTAT ПО ГОРОДУ ===
${wordstatBlock}
${rulesBlock}${topAdsBlock}${failBlock}
=== ТРЕБОВАНИЯ К КАЖДОМУ ВАРИАНТУ ===
1. Каждый вариант — отдельная стратегия. Имена групп придумай САМ исходя из брифа (например: «Боль клиента», «Скидки», «Брендовый», «Событийный», «Конкурентный», «Широкий охват», «По релевантным брендам», «По хобби», «Семейный»).
2. Имя кампании во всех 3 вариантах одинаковое: «${input.geo}-Поиск».
3. Минимум 20 точных ключевиков. Используй слова из Wordstat выше + синонимы. Учитывай намерение из брифа.
4. Минимум 15 минус-слов. Отсекай мусор: бесплатно, скачать, играть онлайн, видео, форум, отзывы, работа, вакансии и т.п.
5. Объявление:
   - title1 (25-35 символов): мощный продающий заголовок. Без знаков препинания в конце.
   - title2 (15-30 символов): ОБЯЗАТЕЛЬНО упомяни город «${input.geo}». Бонус: цена/скидка/УТП.
   - text (50-81 символ): чёткое преимущество + призыв к действию.
   - url: ${input.siteUrl}

=== ФОРМАТ ОТВЕТА (строго) ===
{
  "variants": [
    {
      "variant_id": "v1",
      "title": "Короткое название стратегии (10-25 симв)",
      "strategy_explanation": "1-2 предложения зачем эта стратегия и для кого",
      "draft": {
        "campaign_name": "${input.geo}-Поиск",
        "adgroup_name": "Имя группы (10-30 симв)",
        "keywords": ["ключевая фраза 1", "ключевая фраза 2", "..."],
        "negative_keywords": ["минус 1", "минус 2", "..."],
        "ad": {
          "title1": "...",
          "title2": "...",
          "text": "...",
          "url": "${input.siteUrl}"
        }
      }
    },
    { "variant_id": "v2", ... },
    { "variant_id": "v3", ... }
  ]
}`;

  return { system: SYSTEM, prompt };
}

export interface CampaignVariant {
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

export interface CampaignVariantsResponse {
  variants: CampaignVariant[];
}
