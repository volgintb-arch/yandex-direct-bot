/**
 * Build the tracking URL for an ad — appends utm_* and yclid using
 * Yandex Direct ValueTrack placeholders so we know which ad brought
 * each lead in the CRM.
 *
 * ValueTrack docs: https://yandex.ru/dev/direct/doc/feature/url-params/index.html
 *
 *   {campaign_name}     – campaign name
 *   {campaign_id}       – campaign ID
 *   {ad_id}             – ad ID (THE KEY — we use it as utm_content)
 *   {adgroup_id}        – adgroup ID
 *   {keyword}           – matched keyword
 *   {yandexClickID}     – yclid (substituted at click time)
 */

const BASE_PARAMS: Record<string, string> = {
  utm_source: 'yandex',
  utm_medium: 'cpc',
  utm_campaign: '{campaign_name}',
  utm_content: '{ad_id}',
  utm_term: '{keyword}',
  yclid: '{yandexClickID}',
};

/**
 * Add UTM + ValueTrack to a URL.
 * Preserves existing query params (campaign-specific UTMs win).
 */
export function appendTrackingParams(url: string, override: Record<string, string> = {}): string {
  if (!url) return url;
  const [base, hash = ''] = url.split('#');
  const [path, existingQs = ''] = base!.split('?');
  const existing = new URLSearchParams(existingQs);

  // Add tracking params only if not already present (don't overwrite explicit ones)
  for (const [k, v] of Object.entries({ ...BASE_PARAMS, ...override })) {
    if (!existing.has(k)) existing.set(k, v);
  }

  const qs = existing.toString();
  return path + (qs ? '?' + qs : '') + (hash ? '#' + hash : '');
}
