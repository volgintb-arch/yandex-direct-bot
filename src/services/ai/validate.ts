import type { CampaignVariant } from './prompts/search-campaign.js';

/** Yandex Direct character limits for text ads. */
export const AD_LIMITS = {
  title1: { min: 1, max: 35 },
  title2: { min: 0, max: 30 }, // optional, but if present must fit
  text: { min: 1, max: 81 },
};

export interface AdViolation {
  field: 'title1' | 'title2' | 'text';
  current: number;
  max: number;
  excess: number;
  value: string;
}

/** Returns list of fields that exceed Direct's character limits. */
export function validateAd(ad: CampaignVariant['draft']['ad']): AdViolation[] {
  const violations: AdViolation[] = [];
  for (const field of ['title1', 'title2', 'text'] as const) {
    const value = ad[field] ?? '';
    const max = AD_LIMITS[field].max;
    if (value.length > max) {
      violations.push({
        field,
        current: value.length,
        max,
        excess: value.length - max,
        value,
      });
    }
  }
  return violations;
}

export function validateVariant(variant: CampaignVariant): AdViolation[] {
  return validateAd(variant.draft.ad);
}

export function variantHasIssues(variant: CampaignVariant): boolean {
  return validateVariant(variant).length > 0;
}
