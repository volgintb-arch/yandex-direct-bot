import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { listCampaigns } from '../services/yandex-direct/campaigns.js';
import { listAdgroups } from '../services/yandex-direct/adgroups.js';
import { listAds } from '../services/yandex-direct/ads.js';
import { fetchReport } from '../services/yandex-direct/reports.js';

/**
 * GET /api/marketing/aggregates?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Read-only aggregate of Yandex Direct metrics for QuestLegends OS to overlay
 * on its CRM lead data. The bot is the source of truth for cost/clicks/CTR;
 * QL OS combines this with its own lead/revenue data to compute CPL/ROI.
 *
 * Auth: Authorization: Bearer <INTEGRATION_API_KEY>  (same key as the
 * QL OS → bot direction; it's a server-to-server contract).
 */

const app = new Hono();

interface AggregateCampaign {
  campaignId: number;
  name: string;
  type: 'search' | 'network' | 'mixed';
  city: string | null;
  state: string;
  cost: number;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
}

interface AggregateAd {
  adId: number;
  campaignId: number;
  adgroupId: number;
  title1: string;
  title2: string | null;
  text: string;
  url: string;
  cost: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

function classifyCampaignType(name: string): 'search' | 'network' | 'mixed' {
  const lower = name.toLowerCase();
  if (lower.includes('поиск') || lower.includes('search')) return 'search';
  if (lower.includes('рся') || lower.includes('rsya') || lower.includes('network')) return 'network';
  return 'mixed';
}

/** Extract city from campaign name like "Краснодар-Поиск" or "Krasnodar-RSYA". */
function deriveCity(name: string): string | null {
  const parts = name.split(/[-—–\s]+/);
  return parts[0]?.trim() || null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateParam(value: string | undefined, fallback: string): string {
  if (!value || !ISO_DATE_RE.test(value)) return fallback;
  return value;
}

app.use('*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? '';
  const expected = `Bearer ${config.CRM_INTEGRATION_API_KEY}`;
  if (auth !== expected) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

app.get('/aggregates', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const from = validateDateParam(c.req.query('from'), weekAgo);
  const to = validateDateParam(c.req.query('to'), today);

  try {
    // 1. Campaigns metadata (active + suspended; archived/ended skipped).
    const campaigns = await listCampaigns({ states: ['ON', 'SUSPENDED', 'OFF'] });
    if (campaigns.length === 0) {
      return c.json({
        period: { from, to },
        totals: { cost: 0, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0 },
        campaigns: [],
        ads: [],
      });
    }
    const campaignIds = campaigns.map((c) => c.Id);
    const campaignById = new Map(campaigns.map((c) => [c.Id, c]));

    // 2. Performance reports — campaign + ad granularity in parallel.
    const [campaignRows, adRows, ads, adgroups] = await Promise.all([
      fetchReport({
        reportName: `agg-camp-${from}-${to}-${Date.now()}`,
        reportType: 'CAMPAIGN_PERFORMANCE_REPORT',
        dateRange: 'CUSTOM_DATE',
        dateFrom: from,
        dateTo: to,
        fieldNames: ['CampaignId', 'CampaignName', 'Impressions', 'Clicks', 'Cost', 'AvgCpc', 'Ctr'],
        filter: { campaignIds },
      }),
      fetchReport({
        reportName: `agg-ad-${from}-${to}-${Date.now()}`,
        reportType: 'AD_PERFORMANCE_REPORT',
        dateRange: 'CUSTOM_DATE',
        dateFrom: from,
        dateTo: to,
        fieldNames: ['AdId', 'CampaignId', 'AdGroupId', 'Impressions', 'Clicks', 'Cost', 'Ctr'],
        filter: { campaignIds },
      }),
      listAds({ campaignIds }),
      listAdgroups({ campaignIds }),
    ]);

    const adById = new Map(ads.map((a) => [a.Id, a]));

    // 3. Aggregate campaigns
    const aggCampaigns: AggregateCampaign[] = campaignRows.map((r) => {
      const id = parseInt(r.CampaignId ?? '0', 10) || 0;
      const meta = campaignById.get(id);
      const impressions = parseInt(r.Impressions ?? '0', 10) || 0;
      const clicks = parseInt(r.Clicks ?? '0', 10) || 0;
      const cost = parseFloat(r.Cost ?? '0') || 0;
      const avgCpc = parseFloat(r.AvgCpc ?? '0') || 0;
      const ctr = parseFloat(r.Ctr ?? '0') || 0;
      const name = r.CampaignName ?? meta?.Name ?? '?';
      return {
        campaignId: id,
        name,
        type: classifyCampaignType(name),
        city: deriveCity(name),
        state: meta?.State ?? 'UNKNOWN',
        cost: Math.round(cost * 100) / 100,
        impressions,
        clicks,
        ctr: Math.round(ctr * 100) / 100,
        avgCpc: Math.round(avgCpc * 100) / 100,
      };
    });

    // 4. Aggregate ads
    const aggAds: AggregateAd[] = adRows.map((r) => {
      const id = parseInt(r.AdId ?? '0', 10) || 0;
      const meta = adById.get(id);
      const text = meta?.TextAd ?? meta?.TextImageAd;
      const impressions = parseInt(r.Impressions ?? '0', 10) || 0;
      const clicks = parseInt(r.Clicks ?? '0', 10) || 0;
      const cost = parseFloat(r.Cost ?? '0') || 0;
      const ctr = parseFloat(r.Ctr ?? '0') || 0;
      return {
        adId: id,
        campaignId: parseInt(r.CampaignId ?? '0', 10) || 0,
        adgroupId: parseInt(r.AdGroupId ?? '0', 10) || 0,
        title1: text?.Title ?? '',
        title2: text?.Title2 ?? null,
        text: text?.Text ?? '',
        url: text?.Href ?? '',
        cost: Math.round(cost * 100) / 100,
        impressions,
        clicks,
        ctr: Math.round(ctr * 100) / 100,
      };
    });

    // 5. Totals
    const totals = aggCampaigns.reduce(
      (acc, c) => ({
        cost: acc.cost + c.cost,
        impressions: acc.impressions + c.impressions,
        clicks: acc.clicks + c.clicks,
      }),
      { cost: 0, impressions: 0, clicks: 0 }
    );
    const totalCtr =
      totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : 0;
    const totalAvgCpc = totals.clicks > 0 ? Math.round((totals.cost / totals.clicks) * 100) / 100 : 0;

    return c.json({
      period: { from, to },
      totals: {
        cost: Math.round(totals.cost * 100) / 100,
        impressions: totals.impressions,
        clicks: totals.clicks,
        ctr: totalCtr,
        avgCpc: totalAvgCpc,
      },
      campaigns: aggCampaigns,
      ads: aggAds,
    });
  } catch (err) {
    logger.error({ err, from, to }, 'aggregates failed');
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

export default app;
