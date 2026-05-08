import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import * as ygpt from '../services/ai/yandex-gpt.js';
import { buildLearningPrompt, type AdSnapshot } from '../services/ai/prompts/learning.js';
import { saveKnowledge } from '../services/knowledge/manager.js';

/**
 * Daily learning loop. Runs at 06:00 (or via /learn command).
 *
 *   1. For the last 30 days, group AdMetrics by adId; pull the actual ad
 *      texts so the AI can see the creative.
 *   2. Compute ROI = revenue / cost; rank ads by performance.
 *   3. Top 8 by ROI (with at least 5 clicks) and bottom 8 by ROI
 *      (cost > threshold, no scheduled leads).
 *   4. AI synthesises 5 actionable copywriting rules; saved as
 *      KnowledgeEntry — used as context when generating new campaigns.
 */

const WINDOW_DAYS = 30;
const MIN_CLICKS_FOR_TOP = 5;
const MIN_COST_FOR_BOTTOM = 500; // ₽ — wasted ad threshold

export interface LearningResult {
  scope: 'search' | 'network';
  windowDays: number;
  topCount: number;
  bottomCount: number;
  rules: string;
}

function classifyCampaignType(name: string): 'search' | 'network' | 'mixed' {
  const lower = name.toLowerCase();
  if (lower.includes('поиск') || lower.includes('search')) return 'search';
  if (lower.includes('рся') || lower.includes('rsya') || lower.includes('network')) return 'network';
  return 'mixed';
}

interface AdAggregate extends AdSnapshot {
  adId: bigint;
  campaignName: string;
}

async function loadAdAggregates(scope: 'search' | 'network'): Promise<AdAggregate[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  // Sum metrics over the window per ad.
  const grouped = await db.adMetrics.groupBy({
    by: ['adId'],
    where: { date: { gte: since } },
    _sum: {
      cost: true,
      clicks: true,
      impressions: true,
      scheduled: true,
      revenue: true,
    },
  });

  if (grouped.length === 0) return [];

  // Fetch ad text + parent campaign name for each adId.
  const adIds = grouped.map((g) => g.adId);
  const ads = await db.ad.findMany({
    where: { yandexId: { in: adIds } },
    include: { adgroup: { include: { campaign: true } } },
  });
  const adById = new Map(ads.map((a) => [a.yandexId.toString(), a]));

  const results: AdAggregate[] = [];
  for (const g of grouped) {
    const ad = adById.get(g.adId.toString());
    if (!ad) continue;
    const campaignName = ad.adgroup.campaign.name;
    const type = classifyCampaignType(campaignName);
    if (type !== scope) continue;

    const cost = Number(g._sum.cost ?? 0);
    const clicks = g._sum.clicks ?? 0;
    const impressions = g._sum.impressions ?? 0;
    const scheduled = g._sum.scheduled ?? 0;
    const revenue = Number(g._sum.revenue ?? 0);
    const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
    const cpl = scheduled > 0 ? cost / scheduled : null;
    const roi = cost > 0 ? (revenue - cost) / cost : null;

    results.push({
      adId: g.adId,
      campaignName,
      title1: ad.title1,
      title2: ad.title2,
      text: ad.text,
      url: ad.href,
      cost: Math.round(cost * 100) / 100,
      clicks,
      ctr,
      scheduled,
      revenue: Math.round(revenue * 100) / 100,
      cpl: cpl !== null ? Math.round(cpl * 100) / 100 : null,
      roi: roi !== null ? Math.round(roi * 10000) / 10000 : null,
    });
  }
  return results;
}

function pickTopAndBottom(ads: AdAggregate[]): { top: AdAggregate[]; bottom: AdAggregate[] } {
  const eligibleTop = ads.filter((a) => a.clicks >= MIN_CLICKS_FOR_TOP && a.scheduled > 0);
  const eligibleBottom = ads.filter((a) => a.cost >= MIN_COST_FOR_BOTTOM && a.scheduled === 0);

  const top = [...eligibleTop]
    .sort((a, b) => (b.roi ?? -1) - (a.roi ?? -1))
    .slice(0, 8);
  const bottom = [...eligibleBottom]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  return { top, bottom };
}

async function learnForScope(scope: 'search' | 'network'): Promise<LearningResult | null> {
  const ads = await loadAdAggregates(scope);
  if (ads.length === 0) {
    logger.info({ scope }, 'no ads with metrics for scope, skipping learning');
    return null;
  }
  const { top, bottom } = pickTopAndBottom(ads);
  if (top.length === 0 && bottom.length === 0) {
    logger.info({ scope, total: ads.length }, 'no top/bottom signal yet, skipping');
    return null;
  }

  const { system, prompt } = buildLearningPrompt({
    scope,
    topAds: top,
    bottomAds: bottom,
    windowDays: WINDOW_DAYS,
  });

  let rules = '';
  try {
    rules = await ygpt.generate('pro', { system, prompt, temperature: 0.3, maxTokens: 2000 });
  } catch (err) {
    logger.error({ err, scope }, 'learning AI call failed');
    return null;
  }

  if (!rules.trim()) return null;

  // Save the synthesised rules.
  await saveKnowledge({
    type: 'learned_rules',
    scope,
    data: { rules, window_days: WINDOW_DAYS, top_count: top.length, bottom_count: bottom.length },
    generatedBy: 'deepseek-v32-via-yandex-gpt',
  });

  // Save top ads as separate top_ad entries.
  for (const ad of top.slice(0, 5)) {
    await saveKnowledge({
      type: 'top_ad',
      scope,
      data: {
        title1: ad.title1,
        title2: ad.title2,
        text: ad.text,
        ctr: ad.ctr,
        scheduled: ad.scheduled,
        revenue: ad.revenue,
        roi: ad.roi,
      },
      generatedBy: 'aggregator',
    });
  }

  // Save bottom ads as failure_pattern entries.
  for (const ad of bottom.slice(0, 5)) {
    await saveKnowledge({
      type: 'failure_pattern',
      scope,
      data: {
        title1: ad.title1,
        title2: ad.title2,
        text: ad.text,
        cost: ad.cost,
        clicks: ad.clicks,
        scheduled: ad.scheduled,
      },
      generatedBy: 'aggregator',
    });
  }

  return {
    scope,
    windowDays: WINDOW_DAYS,
    topCount: top.length,
    bottomCount: bottom.length,
    rules,
  };
}

export async function runDailyLearning(): Promise<{
  search: LearningResult | null;
  network: LearningResult | null;
}> {
  logger.info('daily-learning started');
  const [search, network] = await Promise.all([learnForScope('search'), learnForScope('network')]);
  logger.info(
    { search: search?.topCount, network: network?.topCount },
    'daily-learning done'
  );
  return { search, network };
}
