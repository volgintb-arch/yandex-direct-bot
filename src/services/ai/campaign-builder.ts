import * as ygpt from './yandex-gpt.js';
import * as wordstat from '../wordstat/client.js';
import { findRegionByName, ensureRegionsCache } from '../yandex-direct/regions.js';
import { getKnowledgeContext } from '../knowledge/manager.js';
import { buildSearchPrompt, type CampaignVariantsResponse, type CampaignVariant } from './prompts/search-campaign.js';
import { buildCplPrompt, type CplSuggestion } from './prompts/cpl-suggestion.js';
import { buildRevisionPrompt } from './prompts/revision.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';

export interface BuildCampaignInput {
  campaignType: 'search' | 'network';
  geo: string;
  dailyBudget: number;
  targetCpl: number;
  siteUrl: string;
  brief: string;
}

export interface BuildCampaignResult {
  variants: CampaignVariant[];
  regionId: number;
  resolvedGeoName: string;
  wordstatPhrasesUsed: number;
}

/**
 * End-to-end Search campaign generation:
 *   1. Resolve geo → Yandex region ID (cached)
 *   2. Pull top phrases from Wordstat for that region
 *   3. Pull knowledge context (learned rules, top ads, failures)
 *   4. Ask YandexGPT Pro for 3 variants
 */
export async function buildSearchCampaign(
  input: BuildCampaignInput
): Promise<BuildCampaignResult> {
  await ensureRegionsCache();
  const region = await findRegionByName(input.geo);
  if (!region) {
    throw new ApiError(`Город "${input.geo}" не найден в справочнике Яндекса`, 'campaign_builder');
  }

  const [wordstatResp, knowledge] = await Promise.all([
    safeWordstat(input.brief, input.geo, region.yandexId),
    getKnowledgeContext({ scope: 'search', city: region.name }),
  ]);

  const { system, prompt } = buildSearchPrompt({
    geo: region.name,
    dailyBudget: input.dailyBudget,
    targetCpl: input.targetCpl,
    siteUrl: input.siteUrl,
    brief: input.brief,
    wordstatTop: wordstatResp,
    learnedRules: knowledge.rules,
    topAdsExamples: knowledge.topAds,
    failurePatterns: knowledge.failures,
  });

  const json = await ygpt.generateJson<CampaignVariantsResponse>('pro', {
    prompt,
    system,
    temperature: 0.7,
    maxTokens: 6000,
  });

  if (!json.variants || json.variants.length === 0) {
    throw new ApiError('YandexGPT не вернул ни одного варианта', 'campaign_builder');
  }

  return {
    variants: json.variants,
    regionId: region.yandexId,
    resolvedGeoName: region.name,
    wordstatPhrasesUsed: wordstatResp.length,
  };
}

/** Pick a seed phrase from brief for Wordstat — first noun-ish word. */
function pickSeedPhrase(brief: string, geo: string): string {
  // Very rough: take first meaningful 1-3 words from brief.
  const cleaned = brief
    .toLowerCase()
    .replace(/[^а-яa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter((w) => w.length > 3).slice(0, 2);
  if (words.length > 0) return `${words.join(' ')} ${geo.toLowerCase()}`;
  return `квест ${geo.toLowerCase()}`;
}

async function safeWordstat(
  brief: string,
  geo: string,
  regionId: number
): Promise<Array<{ phrase: string; count: number }>> {
  try {
    const seed = pickSeedPhrase(brief, geo);
    const r = await wordstat.getTopRequests(seed, [regionId]);
    return r.topRequests ?? [];
  } catch (err) {
    logger.warn({ err, geo }, 'wordstat failed, continuing without it');
    return [];
  }
}

/**
 * Suggest target CPL using AI based on business profile, city and brief.
 * Used when user picks "💡 Пусть ИИ предложит" instead of entering manually.
 */
export async function suggestCpl(input: {
  campaignType: 'search' | 'network';
  geo: string;
  dailyBudget: number;
  brief: string;
}): Promise<CplSuggestion> {
  const { system, prompt } = buildCplPrompt({
    geo: input.geo,
    dailyBudget: input.dailyBudget,
    campaignType: input.campaignType,
    brief: input.brief,
  });
  return await ygpt.generateJson<CplSuggestion>('pro', {
    prompt,
    system,
    temperature: 0.3,
    maxTokens: 500,
  });
}

/** Apply user-provided revision text to an existing variant. */
export async function reviseVariant(
  current: CampaignVariant,
  revisionText: string
): Promise<CampaignVariant> {
  const { system, prompt } = buildRevisionPrompt(current, revisionText);
  return await ygpt.generateJson<CampaignVariant>('pro', {
    prompt,
    system,
    temperature: 0.4,
    maxTokens: 4000,
  });
}
