import type { CampaignVariant } from '../services/ai/prompts/search-campaign.js';

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const escapeMd = (s: string | null | undefined): string =>
  (s ?? '').replace(/([_*`\[\]])/g, '\\$1');

const safe = (s: string | null | undefined): string => s ?? '—';
const safeLen = (s: string | null | undefined): number => (s ?? '').length;

/** Format a single variant card for Telegram (Markdown). */
export function formatVariantCard(v: CampaignVariant, idx?: number): string {
  const d = v.draft ?? ({} as CampaignVariant['draft']);
  const ad = d.ad ?? ({} as CampaignVariant['draft']['ad']);
  const keywords = d.keywords ?? [];
  const negs = d.negative_keywords ?? [];
  const header = idx !== undefined ? `*Вариант ${idx + 1}: ${escapeMd(v.title)}*` : `*${escapeMd(v.title)}*`;
  const kwSample = keywords.slice(0, 8).map((k) => `\`${escapeMd(k)}\``).join(', ');
  const moreKw = keywords.length > 8 ? ` _и ещё ${keywords.length - 8}_` : '';
  const negSample = negs.slice(0, 5).join(', ');
  const moreNeg = negs.length > 5 ? ` _и ещё ${negs.length - 5}_` : '';

  return [
    header,
    `_${escapeMd(v.strategy_explanation)}_`,
    '',
    `📁 Кампания: \`${escapeMd(safe(d.campaign_name))}\``,
    `📂 Группа: \`${escapeMd(safe(d.adgroup_name))}\``,
    '',
    '*📝 Объявление:*',
    `▸ ${escapeMd(safe(ad.title1))} \\| ${escapeMd(safe(ad.title2))}`,
    `▸ ${escapeMd(safe(ad.text))}`,
    `▸ ${safe(ad.url)}`,
    '',
    `*🔑 Ключевики (${keywords.length}):*`,
    truncate(kwSample + moreKw, 600),
    '',
    `*🚫 Минус-слова (${negs.length}):*`,
    truncate(escapeMd(negSample) + moreNeg, 400),
  ].join('\n');
}

/** Short variant card for the carousel — preview as Direct ad would show. */
export function formatVariantShort(v: CampaignVariant): string {
  const d = v.draft ?? ({} as CampaignVariant['draft']);
  const ad = d.ad ?? ({} as CampaignVariant['draft']['ad']);
  const limit = (val: number, max: number) => (val > max ? `⚠️${val}/${max}` : `${val}/${max}`);
  return [
    `*${escapeMd(v.title)}*`,
    `_${escapeMd(d.adgroup_name)}_ · ${(d.keywords ?? []).length} ключей · ${(d.negative_keywords ?? []).length} минусов`,
    '',
    `🎯 *${escapeMd(safe(ad.title1))}* \\| ${escapeMd(safe(ad.title2))}`,
    `📝 ${escapeMd(safe(ad.text))}`,
    `🔗 ${safe(ad.url)}`,
    `_T1: ${limit(safeLen(ad.title1), 35)} · T2: ${limit(safeLen(ad.title2), 30)} · txt: ${limit(safeLen(ad.text), 81)}_`,
  ].join('\n');
}
