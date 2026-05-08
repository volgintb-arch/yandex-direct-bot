import { fetchReport, type DateRangePreset } from '../yandex-direct/reports.js';
import { listCampaigns } from '../yandex-direct/campaigns.js';
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
  if (lower.includes('поиск') || lower.includes('search')) return 'search';
  if (lower.includes('рся') || lower.includes('rsya') || lower.includes('network')) return 'network';
  return 'mixed';
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

  const campaigns: CampaignStats[] = rows.map((r) => {
    const impressions = parseInt(r.Impressions ?? '0', 10) || 0;
    const clicks = parseInt(r.Clicks ?? '0', 10) || 0;
    const cost = parseFloat(r.Cost ?? '0') || 0;
    const avgCpc = parseFloat(r.AvgCpc ?? '0') || 0;
    const ctr = parseFloat(r.Ctr ?? '0') || 0;
    return {
      campaignId: parseInt(r.CampaignId ?? '0', 10) || 0,
      campaignName: r.CampaignName ?? '?',
      campaignType: classifyCampaignType(r.CampaignName ?? ''),
      impressions,
      clicks,
      cost: Math.round(cost * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      avgCpc: Math.round(avgCpc * 100) / 100,
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

  return {
    days,
    totalImpressions,
    totalClicks,
    totalCost,
    avgCtr,
    avgCpc,
    campaigns,
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
