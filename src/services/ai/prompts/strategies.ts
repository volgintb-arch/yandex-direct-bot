import { config } from '../../../lib/config.js';

export interface BuildStrategiesPromptInput {
  geo: string;
  brief: string;
  wordstatTop: Array<{ phrase: string; count: number }>;
}

const SYSTEM = `Ты — стратег контекстной рекламы. Твоя задача — для одной задачи предложить 3 РАЗНЫЕ стратегии, по которым параллельно подготовят креативы.

Принципы:
- 3 стратегии должны реально отличаться: разная аудитория, разный угол, разные ключевики.
- НЕ выдумывай повод/аудиторию которых нет в брифе.
- Названия стратегий — короткие, говорящие (10-25 символов).

Возвращай только JSON.`;

export function buildStrategiesPrompt(input: BuildStrategiesPromptInput): {
  system: string;
  prompt: string;
} {
  const wordstatBlock = input.wordstatTop.length
    ? input.wordstatTop
        .slice(0, 15)
        .map((r) => `  • ${r.phrase} (${r.count.toLocaleString('ru-RU')})`)
        .join('\n')
    : '  (Wordstat пуст)';

  const prompt = `Бизнес: ${config.BUSINESS_NAME}
${config.BUSINESS_DESCRIPTION}

Город: ${input.geo}

Бриф:
${input.brief.trim()}

Топ-15 запросов из Wordstat:
${wordstatBlock}

Предложи 3 РАЗНЫЕ стратегии для этой кампании. Каждая — отдельный угол захода.
Примеры стратегий: "Боль клиента", "Скидки", "Брендовый", "Событийный", "Конкурентный", "Широкий охват", "По хобби", "Семейный", "Премиум", "По локации".

Формат (только JSON):
{
  "strategies": [
    {
      "name": "Короткое название (10-25 симв)",
      "focus": "1-2 предложения зачем эта стратегия и для кого, какой основной угол",
      "anchor_keywords": ["главные ключевые слова которые задают тон стратегии — 3-5 шт"]
    },
    { "name": "...", "focus": "...", "anchor_keywords": [...] },
    { "name": "...", "focus": "...", "anchor_keywords": [...] }
  ]
}`;
  return { system: SYSTEM, prompt };
}

export interface StrategyIdea {
  name: string;
  focus: string;
  anchor_keywords: string[];
}

export interface StrategiesResponse {
  strategies: StrategyIdea[];
}
