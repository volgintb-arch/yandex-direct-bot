import { findCampaignByName, createSearchCampaign, createNetworkCampaign } from './campaigns.js';
import { findAdgroupByName, createAdgroup } from './adgroups.js';
import { createTextAd, createTextImageAd } from './ads.js';
import { addKeywords, setAdgroupNegativeKeywords } from './keywords.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import type { CampaignVariant } from '../ai/prompts/search-campaign.js';

export interface ApplyResult {
  campaignId: bigint;
  campaignCreated: boolean;
  adgroupId: bigint;
  adgroupCreated: boolean;
  adId: bigint;
  keywordsAdded: number;
}

export interface ApplyInput {
  variant: CampaignVariant;
  campaignType: 'search' | 'network';
  regionId: number;
  dailyBudget: number;
  imageHash?: string; // for РСЯ
}

/**
 * Apply variant to Yandex Direct.
 * Dedupes: if a campaign/adgroup with the same name already exists,
 * reuse it. Always creates a NEW ad.
 */
export async function applyVariant(input: ApplyInput): Promise<ApplyResult> {
  const { variant, campaignType, regionId, dailyBudget, imageHash } = input;
  const draft = variant.draft;

  // 1. Campaign: find or create.
  const existingCampaign = await findCampaignByName(draft.campaign_name);
  let campaignId: number;
  let campaignCreated = false;
  if (existingCampaign) {
    campaignId = existingCampaign.Id;
    logger.info(
      { name: draft.campaign_name, id: campaignId },
      'reusing existing campaign'
    );
  } else {
    campaignId =
      campaignType === 'search'
        ? await createSearchCampaign({ name: draft.campaign_name, dailyBudgetRub: dailyBudget })
        : await createNetworkCampaign({ name: draft.campaign_name, dailyBudgetRub: dailyBudget });
    campaignCreated = true;
    logger.info({ name: draft.campaign_name, id: campaignId }, 'created campaign');
  }

  // 2. Adgroup: find or create.
  const existingAdgroup = await findAdgroupByName(campaignId, draft.adgroup_name);
  let adgroupId: number;
  let adgroupCreated = false;
  let keywordsAdded = 0;
  if (existingAdgroup) {
    adgroupId = existingAdgroup.Id;
    logger.info(
      { name: draft.adgroup_name, id: adgroupId },
      'reusing existing adgroup (keywords NOT added)'
    );
  } else {
    adgroupId = await createAdgroup({
      name: draft.adgroup_name,
      campaignId,
      regionIds: [regionId],
    });
    adgroupCreated = true;
    logger.info({ name: draft.adgroup_name, id: adgroupId }, 'created adgroup');

    // Keywords + negatives only on first creation.
    if (draft.keywords.length > 0) {
      const ids = await addKeywords(adgroupId, draft.keywords);
      keywordsAdded = ids.length;
      logger.info({ count: keywordsAdded }, 'keywords added');
    }
    if (draft.negative_keywords.length > 0) {
      try {
        await setAdgroupNegativeKeywords(adgroupId, draft.negative_keywords);
      } catch (err) {
        logger.warn({ err }, 'failed to set negative keywords (non-fatal)');
      }
    }
  }

  // 3. Ad: always create new.
  const adId = imageHash
    ? await createTextImageAd({
        adgroupId,
        title1: draft.ad.title1,
        title2: draft.ad.title2,
        text: draft.ad.text,
        href: draft.ad.url,
        adImageHash: imageHash,
      })
    : await createTextAd({
        adgroupId,
        title1: draft.ad.title1,
        title2: draft.ad.title2,
        text: draft.ad.text,
        href: draft.ad.url,
      });
  logger.info({ id: adId }, 'created ad');

  // 4. Mirror to local DB for tracking.
  await mirrorToDb({
    campaignId,
    campaignName: draft.campaign_name,
    campaignType,
    regionId,
    dailyBudget,
    adgroupId,
    adgroupName: draft.adgroup_name,
    adId,
    draft,
    imageHash,
  });

  return {
    campaignId: BigInt(campaignId),
    campaignCreated,
    adgroupId: BigInt(adgroupId),
    adgroupCreated,
    adId: BigInt(adId),
    keywordsAdded,
  };
}

async function mirrorToDb(input: {
  campaignId: number;
  campaignName: string;
  campaignType: 'search' | 'network';
  regionId: number;
  dailyBudget: number;
  adgroupId: number;
  adgroupName: string;
  adId: number;
  draft: CampaignVariant['draft'];
  imageHash?: string;
}): Promise<void> {
  await db.campaign.upsert({
    where: { yandexId: BigInt(input.campaignId) },
    create: {
      yandexId: BigInt(input.campaignId),
      name: input.campaignName,
      type: input.campaignType,
      state: 'ON',
      status: 'DRAFT',
      regionId: input.regionId,
      dailyBudget: input.dailyBudget,
    },
    update: { syncedAt: new Date() },
  });

  await db.adgroup.upsert({
    where: { yandexId: BigInt(input.adgroupId) },
    create: {
      yandexId: BigInt(input.adgroupId),
      campaignId: BigInt(input.campaignId),
      name: input.adgroupName,
      regionIds: [input.regionId],
    },
    update: { syncedAt: new Date() },
  });

  await db.ad.create({
    data: {
      yandexId: BigInt(input.adId),
      adgroupId: BigInt(input.adgroupId),
      type: input.imageHash ? 'text_image_ad' : 'text_ad',
      title1: input.draft.ad.title1,
      title2: input.draft.ad.title2,
      text: input.draft.ad.text,
      href: input.draft.ad.url,
      imageHash: input.imageHash ?? null,
      state: 'ON',
      status: 'DRAFT',
    },
  });
}
