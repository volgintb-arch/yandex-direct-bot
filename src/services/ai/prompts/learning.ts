const SYSTEM = `Ты — аналитик контекстной рекламы. Тебе дают список объявлений за период с реальными метриками (показы/клики/CTR + лиды/выручка/ROI). Сделай 5 КОНКРЕТНЫХ правил которые будут использованы при генерации новых объявлений.

Правила должны:
- Быть основаны на закономерностях в данных (а не общих принципах рекламы).
- Быть применимыми при копирайтинге: какие слова/обороты в заголовках работают, какие нет, какая длина, какой призыв.
- Учитывать что НЕ работало (negative learnings) — пункты "избегать ...".
- Быть короткими (1-2 предложения каждое).

Не возвращай JSON — пиши обычным маркдауном.`;

export interface AdSnapshot {
  title1: string;
  title2: string | null;
  text: string;
  url: string;
  cost: number;
  clicks: number;
  ctr: number;
  scheduled: number; // оплаченные лиды
  revenue: number;
  cpl: number | null;
  roi: number | null;
}

export function buildLearningPrompt(input: {
  scope: 'search' | 'network';
  topAds: AdSnapshot[];
  bottomAds: AdSnapshot[];
  windowDays: number;
}): { system: string; prompt: string } {
  const formatList = (label: string, ads: AdSnapshot[]) =>
    ads.length === 0
      ? `(${label}: пусто)`
      : `${label}:\n${ads
          .slice(0, 8)
          .map(
            (a, i) =>
              `${i + 1}. "${a.title1}" | "${a.title2 ?? '—'}" — ${a.text}\n     CTR ${a.ctr}% · кликов ${a.clicks} · scheduled ${a.scheduled} · ROI ${a.roi !== null ? a.roi.toFixed(2) : '—'}`
          )
          .join('\n')}`;

  const prompt = `Тип кампаний: ${input.scope === 'search' ? 'Поиск' : 'РСЯ'}
Период: последние ${input.windowDays} дней

${formatList('🏆 ЛУЧШИЕ ОБЪЯВЛЕНИЯ (по ROI и scheduled)', input.topAds)}

${formatList('💀 ХУДШИЕ ОБЪЯВЛЕНИЯ (расход без отдачи)', input.bottomAds)}

Сформулируй 5 правил для копирайтинга будущих объявлений этой кампании. Каждое правило с обоснованием (1-2 предложения).`;
  return { system: SYSTEM, prompt };
}
