import { fetchReport, type DateRangePreset } from '../yandex-direct/reports.js';
import { listCampaigns } from '../yandex-direct/campaigns.js';
import { fetchRecentLeads, type RecentLead } from '../crm-questlegends/client.js';
import * as ygpt from './yandex-gpt.js';
import {
  buildAnalyticsPrompt,
  buildOptimizationPrompt,
  type AnalyticsContext,
  type CampaignStats,
} from './prompts/analytics.js';
import { logger } from '../../lib/logger.js';

const FIELDS = ['CampaignId', 'CampaignName', 'Impressions', 'Clicks', 'Cost', 'AvgCpc', 'Ctr'];

const DAYS_TO_PRESET: Record<number, DateRangePreset> = {
  7: 'LAST_7_DAYS',
  14: 'LAST_14_DAYS',
  30: 'LAST_30_DAYS',
  90: 'LAST_90_DAYS',
};

function classifyCampaignType(name: string): 'search' | 'network' | 'mixed' {
  const lower = name.toLowerCase();
  if (lower.includes('поиск') || lower.includes('search') || lower.includes('poisk')) return 'search';
  if (lower.includes('рся') || lower.includes('rsya') || lower.includes('network')) return 'network';
  return 'mixed';
}

// CRM aggregation helpers
interface CrmBucket {
  leads: number;
  newCount: number;
  inWork: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  revenue: number;
}

function emptyBucket(): CrmBucket {
  return { leads: 0, newCount: 0, inWork: 0, scheduled: 0, completed: 0, cancelled: 0, revenue: 0 };
}

function addLeadToBucket(b: CrmBucket, lead: RecentLead): void {
  b.leads++;
  // High-level status routing (per spec: scheduled = paid, revenue counts on scheduled)
  if (lead.status === 'cancelled') {
    b.cancelled++;
  } else if (lead.status === 'completed') {
    b.completed++;
    b.scheduled++; // completed is also paid
    b.revenue += Number(lead.revenue ?? 0);
  } else if (lead.status === 'scheduled') {
    b.scheduled++;
    b.revenue += Number(lead.revenue ?? 0);
  } else {
    // Detailed stage from CRM (currentStageType / currentStageName) for context
    const stageName = (lead.currentStageName ?? '').toLowerCase();
    if (stageName.includes('работ')) b.inWork++;
    else b.newCount++;
  }
}

function normalizeCampaignKey(s: string | null): string {
  if (!s) return '__none__';
  return s.toLowerCase().replace(/[\s\-—_]+/g, '');
}

function findCrmForCampaign(directName: string, map: Map<string, CrmBucket>): CrmBucket | null {
  const key = normalizeCampaignKey(directName);
  if (map.has(key)) return map.get(key)!;
  // Fuzzy fallback — Direct name "Квест Поиск" vs CRM utm_campaign "poisk".
  for (const [k, v] of map) {
    if (k && key.includes(k)) return v;
    if (k && k.includes(key)) return v;
  }
  return null;
}

async function safeFetchLeads(from: Date, to: Date): Promise<RecentLead[]> {
  try {
    return await fetchRecentLeads({
      from: from.toISOString(),
      to: to.toISOString(),
      utmSource: 'yandex',
      limit: 5000,
    });
  } catch (err) {
    logger.warn({ err }, 'CRM /recent failed in analytics — continuing without CRM data');
    return [];
  }
}

/**
 * Pull a CAMPAIGN_PERFORMANCE_REPORT, aggregate, build context for AI.
 * Returns null if there are no rows (no campaigns / no traffic).
 *
 * Filters to ONLY currently running campaigns (State=ON).
 * Suspended, off, archived and ended campaigns are excluded — we don't want
 * the AI suggesting tweaks to inactive lines.
 */
export async function loadAnalyticsContext(days = 7): Promise<AnalyticsContext | null> {
  // Step 1: pull list of currently-running campaigns.
  const activeCampaigns = await listCampaigns({ states: ['ON'] });
  if (activeCampaigns.length === 0) {
    logger.info('no active campaigns in account');
    return null;
  }
  const activeIds = activeCampaigns.map((c) => c.Id);

  // Step 2: report scoped to those IDs only.
  const dateRange = DAYS_TO_PRESET[days] ?? 'LAST_7_DAYS';
  const rows = await fetchReport({
    reportName: `bot-analytics-${days}d-${Date.now()}`,
    reportType: 'CAMPAIGN_PERFORMANCE_REPORT',
    dateRange,
    fieldNames: FIELDS,
    filter: { campaignIds: activeIds },
  });

  if (rows.length === 0) return null;

  // 3. CRM enrichment — pull leads with utm_source=yandex for the same window
  //    directly from QL OS. This matches what the «Реклама» tab shows.
  const periodFrom = new Date(Date.now() - days * 24 * 3600 * 1000);
  const periodTo = new Date();
  const crmLeads = await safeFetchLeads(periodFrom, periodTo);

  // Group leads by Direct campaign name (utm_campaign matches CampaignName
  // when our apply-engine sets utm_campaign={campaign_name}). Falls back to
  // case-insensitive contains so "Квест Поиск" matches "poisk", "квест-поиск" etc.
  const crmByCampaign = new Map<string, CrmBucket>();
  for (const lead of crmLeads) {
    const key = normalizeCampaignKey(lead.utm_campaign);
    const acc = crmByCampaign.get(key) ?? emptyBucket();
    addLeadToBucket(acc, lead);
    crmByCampaign.set(key, acc);
  }

  const campaigns: CampaignStats[] = rows.map((r) => {
    const cid = parseInt(r.CampaignId ?? '0', 10) || 0;
    const name = r.CampaignName ?? '?';
    const impressions = parseInt(r.Impressions ?? '0', 10) || 0;
    const clicks = parseInt(r.Clicks ?? '0', 10) || 0;
    const cost = parseFloat(r.Cost ?? '0') || 0;
    const avgCpc = parseFloat(r.AvgCpc ?? '0') || 0;
    const ctr = parseFloat(r.Ctr ?? '0') || 0;
    const crm = findCrmForCampaign(name, crmByCampaign);
    const cpl = crm && crm.scheduled > 0 ? Math.round((cost / crm.scheduled) * 100) / 100 : null;
    const roi = crm && cost > 0 ? Math.round(((crm.revenue - cost) / cost) * 10000) / 10000 : null;
    return {
      campaignId: cid,
      campaignName: name,
      campaignType: classifyCampaignType(name),
      impressions,
      clicks,
      cost: Math.round(cost * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      avgCpc: Math.round(avgCpc * 100) / 100,
      ...(crm
        ? {
            leads: crm.leads,
            inWork: crm.inWork,
            scheduled: crm.scheduled,
            completed: crm.completed,
            cancelled: crm.cancelled,
            revenue: Math.round(crm.revenue * 100) / 100,
            cpl,
            roi,
          }
        : {}),
    };
  });

  // Sort by cost desc — biggest first
  campaigns.sort((a, b) => b.cost - a.cost);

  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalCost = Math.round(campaigns.reduce((s, c) => s + c.cost, 0) * 100) / 100;
  const avgCtr = totalImpressions > 0
    ? Math.round((totalClicks / totalImpressions) * 10000) / 100
    : 0;
  const avgCpc = totalClicks > 0 ? Math.round((totalCost / totalClicks) * 100) / 100 : 0;

  // CRM totals — count from ALL fetched leads, not just matched-to-campaign
  // (this matches what the «Реклама» tab shows on QL OS).
  const allBuckets = emptyBucket();
  for (const lead of crmLeads) addLeadToBucket(allBuckets, lead);

  const cpl = allBuckets.scheduled > 0 ? Math.round((totalCost / allBuckets.scheduled) * 100) / 100 : null;
  const roi = totalCost > 0
    ? Math.round(((allBuckets.revenue - totalCost) / totalCost) * 10000) / 10000
    : null;
  const conversionRate =
    allBuckets.leads > 0 ? Math.round((allBuckets.scheduled / allBuckets.leads) * 10000) / 100 : 0;

  return {
    days,
    totalImpressions,
    totalClicks,
    totalCost,
    avgCtr,
    avgCpc,
    campaigns,
    ...(allBuckets.leads > 0
      ? {
          totalLeads: allBuckets.leads,
          totalNew: allBuckets.newCount,
          totalInWork: allBuckets.inWork,
          totalScheduled: allBuckets.scheduled,
          totalCompleted: allBuckets.completed,
          totalCancelled: allBuckets.cancelled,
          totalRevenue: Math.round(allBuckets.revenue * 100) / 100,
          cpl,
          roi,
          conversionRate,
        }
      : {}),
  };
}

/**
 * YandexGPT often refuses topics that mention "Яндекс" with this canned message.
 * Detect → retry on Lite tier (less restrictive) → fall back to empty.
 */
const REFUSAL_MARKERS = ['не могу обсуж', 'давайте поговорим', 'не могу помочь'];

function isRefusal(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return REFUSAL_MARKERS.some((m) => lower.includes(m)) || lower.length < 30;
}

async function generateWithFallback(
  system: string,
  prompt: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  try {
    const r = await ygpt.generate('pro', { system, prompt, temperature, maxTokens });
    if (!isRefusal(r)) return r;
    logger.warn({ preview: r.slice(0, 80) }, 'Pro refused, retrying with Lite');
  } catch (err) {
    logger.warn({ err }, 'Pro failed, retrying with Lite');
  }
  try {
    const r = await ygpt.generate('lite', { system, prompt, temperature, maxTokens });
    if (!isRefusal(r)) return r;
    logger.warn({ preview: r.slice(0, 80) }, 'Lite also refused');
  } catch (err) {
    logger.warn({ err }, 'Lite also failed');
  }
  return '';
}

export async function summarizeAnalytics(ctx: AnalyticsContext): Promise<string> {
  const { system, prompt } = buildAnalyticsPrompt(ctx);
  return generateWithFallback(system, prompt, 0.3, 1500);
}

export async function suggestOptimizations(ctx: AnalyticsContext): Promise<string> {
  const { system, prompt } = buildOptimizationPrompt(ctx);
  return generateWithFallback(system, prompt, 0.4, 2000);
}
