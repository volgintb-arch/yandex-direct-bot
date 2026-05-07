import type { CampaignVariant } from './search-campaign.js';
import type { AdViolation } from '../validate.js';

const SYSTEM = `Ты — копирайтер. Тебе дают объявление и список превышений. Сократи КОНКРЕТНЫЕ поля до лимитов, сохраняя смысл и УТП. Остальное не трогай.

Возвращай только JSON в той же структуре что вход.`;

export function buildShrinkPrompt(
  variant: CampaignVariant,
  violations: AdViolation[]
): { system: string; prompt: string } {
  const violationsBlock = violations
    .map((v) => `  • ${v.field}: ${v.current} симв (max ${v.max}, нужно убрать ${v.excess}). Сейчас: "${v.value}"`)
    .join('\n');

  const prompt = `Объявление:
\`\`\`json
${JSON.stringify(variant, null, 2)}
\`\`\`

Поля с превышением лимита Яндекс.Директ:
${violationsBlock}

Сократи перечисленные поля до лимита (или меньше). Сохрани смысл, тон, призыв к действию.
Не меняй ключевики, минус-слова, имена, url — только указанные поля объявления.

Верни ОБНОВЛЁННЫЙ полный вариант (та же JSON-структура).`;
  return { system: SYSTEM, prompt };
}
