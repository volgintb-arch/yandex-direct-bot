import * as ygpt from './yandex-gpt.js';
import * as wordstat from '../wordstat/client.js';
import { findRegionByName, ensureRegionsCache } from '../yandex-direct/regions.js';
import { getKnowledgeContext } from '../knowledge/manager.js';
import type { CampaignVariant } from './prompts/search-campaign.js';
import { buildStrategiesPrompt, type StrategiesResponse } from './prompts/strategies.js';
import { buildSearchVariantPrompt } from './prompts/search-variant.js';
import {
  buildNetworkVariantPrompt,
  type NetworkVariantResponse,
} from './prompts/network-variant.js';
import { buildCplPrompt, type CplSuggestion } from './prompts/cpl-suggestion.js';
import { buildRevisionPrompt } from './prompts/revision.js';
import { buildShrinkPrompt } from './prompts/shrink.js';
import { validateVariant } from './validate.js';
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

/** Variant + chosen image for РСЯ. */
export interface NetworkVariantWithImage extends CampaignVariant {
  selectedImageHash: string | null;
  selectedImageDescription: string | null;
}

export interface BuildNetworkCampaignResult {
  variants: NetworkVariantWithImage[];
  regionId: number;
  resolvedGeoName: string;
  imagesAvailable: number;
}

/**
 * Multi-call generation for reliability:
 *   1. Resolve geo + pull Wordstat + knowledge in parallel
 *   2. YandexGPT Lite suggests 3 distinct strategies
 *   3. YandexGPT Pro generates ONE variant per strategy in parallel
 *
 * Single big-prompt approaches kept truncating the JSON.
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
    safeWordstat(input.brief, region.yandexId),
    getKnowledgeContext({ scope: 'search', city: region.name }),
  ]);

  // Step 1: 3 strategies via Lite (cheap + fast).
  const stratPrompt = buildStrategiesPrompt({
    geo: region.name,
    brief: input.brief,
    wordstatTop: wordstatResp,
  });
  const strategiesResp = await ygpt.generateJson<StrategiesResponse>('lite', {
    prompt: stratPrompt.prompt,
    system: stratPrompt.system,
    temperature: 0.8,
    maxTokens: 2000,
  });
  const strategies = strategiesResp.strategies?.slice(0, 3) ?? [];
  if (strategies.length === 0) {
    throw new ApiError('YandexGPT не предложил ни одной стратегии', 'campaign_builder');
  }
  logger.info({ count: strategies.length, strategies: strategies.map((s) => s.name) }, 'strategies suggested');

  // Step 2: 3 parallel variant generations via Pro.
  const variantPromises = strategies.map(async (strategy, idx) => {
    const { system, prompt } = buildSearchVariantPrompt({
      geo: region.name,
      dailyBudget: input.dailyBudget,
      targetCpl: input.targetCpl,
      siteUrl: input.siteUrl,
      brief: input.brief,
      strategy,
      wordstatTop: wordstatResp,
      learnedRules: knowledge.rules,
      topAdsExamples: knowledge.topAds,
      documents: knowledge.documents,
    });
    try {
      let variant = await ygpt.generateJson<CampaignVariant>('pro', {
        prompt,
        system,
        temperature: 0.7,
        maxTokens: 5000,
      });
      // Validate structure — model sometimes drops fields.
      if (!isWellFormedVariant(variant)) {
        logger.warn({ strategy: strategy.name, got: Object.keys(variant ?? {}) }, 'variant missing fields');
        return null;
      }
      variant = { ...variant, variant_id: `v${idx + 1}` };
      // Auto-shrink once if model exceeded char limits.
      const violations = validateVariant(variant);
      if (violations.length > 0) {
        logger.info(
          { strategy: strategy.name, violations: violations.map((v) => `${v.field} ${v.current}/${v.max}`) },
          'variant violates limits — auto-shrinking'
        );
        try {
          variant = await shrinkVariant(variant);
        } catch (err) {
          logger.warn({ err }, 'auto-shrink failed, returning original');
        }
      }
      return variant;
    } catch (err) {
      logger.warn({ err, strategy: strategy.name }, 'variant generation failed');
      return null;
    }
  });

  const variants = (await Promise.all(variantPromises)).filter(
    (v): v is CampaignVariant => v !== null
  );
  if (variants.length === 0) {
    throw new ApiError('Не удалось сгенерировать ни одного варианта', 'campaign_builder');
  }

  return {
    variants,
    regionId: region.yandexId,
    resolvedGeoName: region.name,
    wordstatPhrasesUsed: wordstatResp.length,
  };
}

export interface BuildNetworkCampaignInput extends BuildCampaignInput {
  /** Pre-chosen image — same one is used for all 3 variants. */
  imageHash?: string | null;
  imageDescription?: string | null;
}

/**
 * Multi-call РСЯ generation. Image is chosen by user BEFORE generation
 * (one image per request, applied to all 3 variants).
 *   1. Resolve geo + Wordstat seeds + knowledge in parallel
 *   2. Lite suggests 3 strategies tuned for РСЯ
 *   3. 3 parallel Pro calls — each gets the same image description
 */
export async function buildNetworkCampaign(
  input: BuildNetworkCampaignInput
): Promise<BuildNetworkCampaignResult> {
  await ensureRegionsCache();
  const region = await findRegionByName(input.geo);
  if (!region) {
    throw new ApiError(`Город "${input.geo}" не найден в справочнике Яндекса`, 'campaign_builder');
  }

  const [wordstatResp, knowledge] = await Promise.all([
    safeWordstat(input.brief, region.yandexId),
    getKnowledgeContext({ scope: 'network', city: region.name }),
  ]);

  const stratPrompt = buildStrategiesPrompt({
    geo: region.name,
    brief: input.brief,
    wordstatTop: wordstatResp,
  });
  const strategiesResp = await ygpt.generateJson<StrategiesResponse>('lite', {
    prompt: stratPrompt.prompt,
    system: stratPrompt.system,
    temperature: 0.85,
    maxTokens: 2000,
  });
  const strategies = strategiesResp.strategies?.slice(0, 3) ?? [];
  if (strategies.length === 0) {
    throw new ApiError('YandexGPT не предложил стратегий', 'campaign_builder');
  }

  // 3 parallel variant generations — all bound to the same chosen image.
  const variantPromises = strategies.map(async (strategy, idx) => {
    const { system, prompt } = buildNetworkVariantPrompt({
      geo: region.name,
      dailyBudget: input.dailyBudget,
      targetCpl: input.targetCpl,
      siteUrl: input.siteUrl,
      brief: input.brief,
      strategy,
      imageDescription: input.imageDescription ?? null,
      learnedRules: knowledge.rules,
      topAdsExamples: knowledge.topAds,
    });

    try {
      const resp = await ygpt.generateJson<NetworkVariantResponse>('pro', {
        prompt,
        system,
        temperature: 0.75,
        maxTokens: 5000,
      });
      if (!isWellFormedVariant(resp as unknown as CampaignVariant)) {
        logger.warn({ strategy: strategy.name }, 'network variant missing fields');
        return null;
      }

      let variant: NetworkVariantWithImage = {
        variant_id: `v${idx + 1}`,
        title: resp.title,
        strategy_explanation: resp.strategy_explanation,
        draft: resp.draft,
        selectedImageHash: input.imageHash ?? null,
        selectedImageDescription: input.imageDescription ?? null,
      };

      const violations = validateVariant(variant);
      if (violations.length > 0) {
        try {
          const shrunk = await shrinkVariant(variant);
          variant = {
            ...shrunk,
            selectedImageHash: variant.selectedImageHash,
            selectedImageDescription: variant.selectedImageDescription,
          };
        } catch (err) {
          logger.warn({ err }, 'auto-shrink failed for network variant');
        }
      }
      return variant;
    } catch (err) {
      logger.warn({ err, strategy: strategy.name }, 'network variant generation failed');
      return null;
    }
  });

  const variants = (await Promise.all(variantPromises)).filter(
    (v): v is NetworkVariantWithImage => v !== null
  );
  if (variants.length === 0) {
    throw new ApiError('Не удалось сгенерировать ни одного РСЯ-варианта', 'campaign_builder');
  }

  // Count distinct images available across all variants' searches
  const totalImages = await (async () => {
    const { db } = await import('../../lib/db.js');
    return db.yandexImage.count();
  })();

  return {
    variants,
    regionId: region.yandexId,
    resolvedGeoName: region.name,
    imagesAvailable: totalImages,
  };
}

function isWellFormedVariant(v: unknown): v is CampaignVariant {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const draft = r.draft as Record<string, unknown> | undefined;
  if (!draft) return false;
  const ad = draft.ad as Record<string, unknown> | undefined;
  if (!ad) return false;
  return (
    typeof ad.title1 === 'string' &&
    typeof ad.text === 'string' &&
    typeof draft.campaign_name === 'string' &&
    Array.isArray(draft.keywords)
  );
}

/**
 * Wordstat seeds: combine our core business keyword with one secondary
 * topic keyword pulled from the brief (if any).
 */
function pickSeeds(brief: string): string[] {
  const seeds = ['квест'];
  const briefLower = brief.toLowerCase();
  const triggers: Array<{ contains: string; seed: string }> = [
    { contains: 'день рождения', seed: 'квест день рождения' },
    { contains: 'корпоратив', seed: 'квест корпоратив' },
    { contains: 'тимбилдинг', seed: 'тимбилдинг' },
    { contains: 'выпускной', seed: 'квест выпускной' },
    { contains: 'девичник', seed: 'квест девичник' },
    { contains: 'мальчишник', seed: 'квест мальчишник' },
    { contains: 'для детей', seed: 'детский квест' },
    { contains: 'для подростков', seed: 'квест для подростков' },
    { contains: 'хоррор', seed: 'хоррор квест' },
    { contains: 'пират', seed: 'квест пираты' },
  ];
  for (const t of triggers) {
    if (briefLower.includes(t.contains) && !seeds.includes(t.seed)) {
      seeds.push(t.seed);
      if (seeds.length >= 2) break;
    }
  }
  return seeds;
}

async function safeWordstat(
  brief: string,
  regionId: number
): Promise<Array<{ phrase: string; count: number }>> {
  const seeds = pickSeeds(brief);
  const all = new Map<string, number>();
  for (const seed of seeds) {
    try {
      const r = await wordstat.getTopRequests(seed, [regionId]);
      for (const item of r.topRequests ?? []) {
        if (!all.has(item.phrase) || all.get(item.phrase)! < item.count) {
          all.set(item.phrase, item.count);
        }
      }
    } catch (err) {
      logger.warn({ err, seed }, 'wordstat seed failed, continuing');
    }
  }
  return Array.from(all.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([phrase, count]) => ({ phrase, count }));
}

/** Suggest target CPL using AI based on business profile, city and brief. */
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

/** Ask AI to shrink fields that exceed Direct char limits. */
export async function shrinkVariant(variant: CampaignVariant): Promise<CampaignVariant> {
  const violations = validateVariant(variant);
  if (violations.length === 0) return variant;
  const { system, prompt } = buildShrinkPrompt(variant, violations);
  const updated = await ygpt.generateJson<CampaignVariant>('pro', {
    prompt,
    system,
    temperature: 0.3,
    maxTokens: 2000,
  });
  // Preserve variant_id which model may regenerate
  return { ...updated, variant_id: variant.variant_id };
}
