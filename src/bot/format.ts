import type { CampaignVariant } from '../services/ai/prompts/search-campaign.js';

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const escapeMd = (s: string): string => s.replace(/([_*`\[\]])/g, '\\$1');

/** Format a single variant card for Telegram (Markdown). */
export function formatVariantCard(v: CampaignVariant, idx?: number): string {
  const d = v.draft;
  const header = idx !== undefined ? `*Вариант ${idx + 1}: ${escapeMd(v.title)}*` : `*${escapeMd(v.title)}*`;
  const kwSample = d.keywords.slice(0, 8).map((k) => `\`${escapeMd(k)}\``).join(', ');
  const moreKw = d.keywords.length > 8 ? ` _и ещё ${d.keywords.length - 8}_` : '';
  const negSample = d.negative_keywords.slice(0, 5).join(', ');
  const moreNeg =
    d.negative_keywords.length > 5 ? ` _и ещё ${d.negative_keywords.length - 5}_` : '';

  return [
    header,
    `_${escapeMd(v.strategy_explanation)}_`,
    '',
    `📁 Кампания: \`${escapeMd(d.campaign_name)}\``,
    `📂 Группа: \`${escapeMd(d.adgroup_name)}\``,
    '',
    '*📝 Объявление:*',
    `▸ ${escapeMd(d.ad.title1)} \\| ${escapeMd(d.ad.title2)}`,
    `▸ ${escapeMd(d.ad.text)}`,
    `▸ ${d.ad.url}`,
    '',
    `*🔑 Ключевики (${d.keywords.length}):*`,
    truncate(kwSample + moreKw, 600),
    '',
    `*🚫 Минус-слова (${d.negative_keywords.length}):*`,
    truncate(escapeMd(negSample) + moreNeg, 400),
  ].join('\n');
}

/** Short one-line summary for the carousel. */
export function formatVariantShort(v: CampaignVariant): string {
  const d = v.draft;
  return `*${escapeMd(v.title)}*\n_${escapeMd(d.adgroup_name)}_ · ${d.keywords.length} ключей · ${d.negative_keywords.length} минусов\n▸ ${escapeMd(d.ad.title1)}`;
}
