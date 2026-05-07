import type { CampaignVariant } from './search-campaign.js';

const SYSTEM = `Ты — копирайтер контекстной рекламы. Тебе дают текущий вариант объявления и правки от заказчика. Применяй ТОЛЬКО то, что просили, остальное оставь как есть.

Если правка про объявление (заголовок/текст) — меняй только title1/title2/text/url.
Если правка про ключевики — меняй только keywords/negative_keywords.
Если правка про название — меняй adgroup_name.
Не выдумывай факты, которых нет в исходном варианте или в правке.

Возвращай ОБНОВЛЁННЫЙ полный вариант в той же JSON-структуре. Только JSON, без markdown.`;

export function buildRevisionPrompt(
  current: CampaignVariant,
  revisionText: string
): { system: string; prompt: string } {
  const prompt = `Текущий вариант:
\`\`\`json
${JSON.stringify(current, null, 2)}
\`\`\`

Правки от заказчика:
${revisionText.trim()}

Верни ОБНОВЛЁННЫЙ вариант (та же JSON-структура с теми же полями: variant_id, title, strategy_explanation, draft).`;
  return { system: SYSTEM, prompt };
}
