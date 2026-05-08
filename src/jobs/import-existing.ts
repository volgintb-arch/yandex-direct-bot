import { listCampaigns } from '../services/yandex-direct/campaigns.js';
import { listAdgroups } from '../services/yandex-direct/adgroups.js';
import { listAds } from '../services/yandex-direct/ads.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';

/**
 * Mirror every campaign/adgroup/ad currently in the Direct account into our
 * local DB so sync-leads can attach AdMetrics to them too.
 *
 * Idempotent — runs safely multiple times. Brings campaigns in any state
 * (ON, OFF, SUSPENDED, ARCHIVED, ENDED, CONVERTED) so historical performance
 * is fully traceable.
 */

export interface ImportResult {
  campaigns: { total: number; created: number; updated: number };
  adgroups: { total: number; created: number; updated: number };
  ads: { total: number; created: number; updated: number };
}

function classifyType(name: string): 'search' | 'network' | 'mixed' {
  const lower = name.toLowerCase();
  if (lower.includes('поиск') || lower.includes('search')) return 'search';
  if (lower.includes('рся') || lower.includes('rsya') || lower.includes('network')) return 'network';
  return 'mixed';
}

function deriveCity(name: string): string | null {
  const parts = name.split(/[-—–\s]+/);
  return parts[0]?.trim() || null;
}

export async function importExisting(): Promise<ImportResult> {
  logger.info('import-existing started');
  const result: ImportResult = {
    campaigns: { total: 0, created: 0, updated: 0 },
    adgroups: { total: 0, created: 0, updated: 0 },
    ads: { total: 0, created: 0, updated: 0 },
  };

  // 1. Campaigns — all states except CONVERTED (those are migrated/archived).
  const campaigns = await listCampaigns({
    states: ['ON', 'OFF', 'SUSPENDED', 'ARCHIVED', 'ENDED'],
  });
  result.campaigns.total = campaigns.length;

  for (const c of campaigns) {
    const existing = await db.campaign.findUnique({ where: { yandexId: BigInt(c.Id) } });
    await db.campaign.upsert({
      where: { yandexId: BigInt(c.Id) },
      create: {
        yandexId: BigInt(c.Id),
        name: c.Name,
        type: classifyType(c.Name),
        state: c.State,
        status: c.Status,
        city: deriveCity(c.Name),
      },
      update: {
        name: c.Name,
        state: c.State,
        status: c.Status,
        syncedAt: new Date(),
      },
    });
    if (existing) result.campaigns.updated++;
    else result.campaigns.created++;
  }

  if (campaigns.length === 0) {
    logger.info('no campaigns in account');
    return result;
  }

  // 2. Adgroups — pulled in one shot for all campaigns.
  const campaignIds = campaigns.map((c) => c.Id);
  const adgroups = await listAdgroups({ campaignIds });
  result.adgroups.total = adgroups.length;

  for (const ag of adgroups) {
    const existing = await db.adgroup.findUnique({ where: { yandexId: BigInt(ag.Id) } });
    await db.adgroup.upsert({
      where: { yandexId: BigInt(ag.Id) },
      create: {
        yandexId: BigInt(ag.Id),
        campaignId: BigInt(ag.CampaignId),
        name: ag.Name,
        regionIds: ag.RegionIds ?? [],
      },
      update: {
        name: ag.Name,
        regionIds: ag.RegionIds ?? [],
        syncedAt: new Date(),
      },
    });
    if (existing) result.adgroups.updated++;
    else result.adgroups.created++;
  }

  // 3. Ads — also pulled at once, with creative texts.
  const ads = await listAds({ campaignIds });
  result.ads.total = ads.length;

  for (const ad of ads) {
    const text = ad.TextAd ?? ad.TextImageAd;
    if (!text) continue; // skip non-text ad types we don't support
    const existing = await db.ad.findUnique({ where: { yandexId: BigInt(ad.Id) } });

    if (existing) {
      await db.ad.update({
        where: { yandexId: BigInt(ad.Id) },
        data: {
          title1: text.Title,
          title2: text.Title2 ?? null,
          text: text.Text,
          href: text.Href,
          imageHash: ad.TextImageAd?.AdImageHash ?? null,
          state: ad.State,
          status: ad.Status,
          syncedAt: new Date(),
        },
      });
      result.ads.updated++;
    } else {
      await db.ad.create({
        data: {
          yandexId: BigInt(ad.Id),
          adgroupId: BigInt(ad.AdGroupId),
          type: ad.TextImageAd ? 'text_image_ad' : 'text_ad',
          title1: text.Title,
          title2: text.Title2 ?? null,
          text: text.Text,
          href: text.Href,
          imageHash: ad.TextImageAd?.AdImageHash ?? null,
          state: ad.State,
          status: ad.Status,
        },
      });
      result.ads.created++;
    }
  }

  logger.info({ result }, 'import-existing done');
  return result;
}
