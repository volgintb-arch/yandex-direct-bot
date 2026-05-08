import { fetchRecentLeads, type RecentLead } from '../services/crm-questlegends/client.js';
import { fetchReport } from '../services/yandex-direct/reports.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';

/**
 * Sync CRM leads + Direct cost into local YclidLink and AdMetrics tables.
 *
 * Runs every 4h (and on-demand via /sync command).
 *
 * Flow:
 *   1. Pull all leads from CRM with utm_source=yandex for the window
 *   2. For each lead: try to extract ad_id from utm_content (we set
 *      utm_content={ad_id} via ValueTrack at create time)
 *   3. Upsert YclidLink (yclid → ad_id + lead status + revenue)
 *   4. Pull cost/clicks/impressions per ad per day from Direct
 *   5. Combine into AdMetrics (cost from Direct, leads/scheduled/completed/revenue from CRM)
 */

export interface SyncResult {
  windowFrom: string;
  windowTo: string;
  leadsFetched: number;
  yclidsUpserted: number;
  metricsUpserted: number;
  unmappableLeads: number;
}

/** Last sync watermark — falls back to 30 days ago on cold start. */
async function getWatermark(): Promise<Date> {
  const last = await db.yclidLink.findFirst({
    where: { syncedFromCrmAt: { not: null } },
    orderBy: { syncedFromCrmAt: 'desc' },
    select: { syncedFromCrmAt: true },
  });
  if (last?.syncedFromCrmAt) {
    // Re-fetch a bit of overlap to catch status updates on existing leads.
    return new Date(last.syncedFromCrmAt.getTime() - 6 * 3600 * 1000);
  }
  return new Date(Date.now() - 30 * 24 * 3600 * 1000);
}

function parseAdIdFromUtm(utmContent: string | null): bigint | null {
  if (!utmContent) return null;
  // utm_content set by ValueTrack as {ad_id} → just digits.
  const m = utmContent.match(/\d+/);
  if (!m) return null;
  try {
    return BigInt(m[0]);
  } catch {
    return null;
  }
}

function dateOnly(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Step 1+2+3: pull leads, upsert YclidLink. */
async function syncLeadsToYclidLinks(from: Date, to: Date): Promise<{
  leads: RecentLead[];
  upserted: number;
  unmappable: number;
}> {
  const leads = await fetchRecentLeads({
    from: from.toISOString(),
    to: to.toISOString(),
    utmSource: 'yandex',
    limit: 5000,
  });

  let upserted = 0;
  let unmappable = 0;

  for (const lead of leads) {
    const adId = parseAdIdFromUtm(lead.utmContent);
    if (!adId && !lead.yclid) {
      // Can't tie to a specific ad — skip.
      unmappable++;
      continue;
    }

    // Use yclid as the natural key when present; otherwise fabricate one
    // from leadId so we don't lose lead-level signal.
    const yclidKey = lead.yclid || `lead-${lead.leadId}`;

    await db.yclidLink.upsert({
      where: { yclid: yclidKey },
      create: {
        yclid: yclidKey,
        adId: adId ?? null,
        crmLeadId: lead.leadId,
        crmLeadType: lead.leadType,
        isLead: true,
        isScheduled: lead.status === 'scheduled' || lead.status === 'completed',
        isCompleted: lead.status === 'completed',
        isCancelled: lead.status === 'cancelled',
        // 'scheduled' = пред-оплата получена → revenue считается (по требованию пользователя)
        saleAmount:
          lead.status === 'scheduled' || lead.status === 'completed'
            ? lead.revenue ?? null
            : null,
        city: lead.city ?? null,
        capturedAt: new Date(lead.createdAt),
        syncedFromCrmAt: new Date(),
      },
      update: {
        adId: adId ?? null,
        crmLeadId: lead.leadId,
        crmLeadType: lead.leadType,
        isScheduled: lead.status === 'scheduled' || lead.status === 'completed',
        isCompleted: lead.status === 'completed',
        isCancelled: lead.status === 'cancelled',
        saleAmount:
          lead.status === 'scheduled' || lead.status === 'completed'
            ? lead.revenue ?? null
            : null,
        city: lead.city ?? null,
        syncedFromCrmAt: new Date(),
      },
    });
    upserted++;
  }
  return { leads, upserted, unmappable };
}

/** Step 4: pull cost/clicks/impressions per ad per day from Direct. */
async function syncDirectCostToAdMetrics(from: Date, to: Date): Promise<number> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  const rows = await fetchReport({
    reportName: `bot-sync-cost-${fromDate}-${toDate}-${Date.now()}`,
    reportType: 'AD_PERFORMANCE_REPORT',
    dateRange: 'CUSTOM_DATE',
    dateFrom: fromDate,
    dateTo: toDate,
    fieldNames: ['Date', 'AdId', 'Impressions', 'Clicks', 'Cost', 'Ctr', 'AvgCpc'],
  });

  let upserted = 0;
  for (const row of rows) {
    const adIdStr = row.AdId ?? '0';
    const adId = adIdStr === '0' ? null : (() => {
      try { return BigInt(adIdStr); } catch { return null; }
    })();
    if (!adId) continue;
    const date = dateOnly(row.Date ?? null);
    if (!date) continue;

    const impressions = parseInt(row.Impressions ?? '0', 10) || 0;
    const clicks = parseInt(row.Clicks ?? '0', 10) || 0;
    const cost = parseFloat(row.Cost ?? '0') || 0;
    const ctr = parseFloat(row.Ctr ?? '0') || 0;
    const avgCpc = parseFloat(row.AvgCpc ?? '0') || 0;

    // Only sync metrics for ads we know about — skip "phantom" ads from
    // pre-bot history (would violate FK constraint on AdMetrics.adId).
    const adExists = await db.ad.findUnique({ where: { yandexId: adId }, select: { yandexId: true } });
    if (!adExists) continue;

    await db.adMetrics.upsert({
      where: { adId_date: { adId, date } },
      create: {
        adId, date, impressions, clicks,
        cost, ctr, avgCpc,
      },
      update: {
        impressions, clicks, cost, ctr, avgCpc,
        syncedAt: new Date(),
      },
    });
    upserted++;
  }
  return upserted;
}

/** Step 5: roll up YclidLink → AdMetrics CRM columns. */
async function rollupCrmToAdMetrics(from: Date, to: Date): Promise<number> {
  // Group YclidLinks by (adId, day) and add lead/scheduled/completed/revenue
  // to the AdMetrics row that already has cost from step 4.
  const links = await db.yclidLink.findMany({
    where: {
      adId: { not: null },
      capturedAt: { gte: from, lte: to },
    },
  });

  type Bucket = {
    adId: bigint;
    date: Date;
    leads: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    revenue: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const link of links) {
    if (!link.adId) continue;
    const day = new Date(link.capturedAt);
    day.setUTCHours(0, 0, 0, 0);
    const key = `${link.adId}|${day.toISOString()}`;
    const b = buckets.get(key) ?? {
      adId: link.adId,
      date: day,
      leads: 0,
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      revenue: 0,
    };
    b.leads++;
    if (link.isScheduled) b.scheduled++;
    if (link.isCompleted) b.completed++;
    if (link.isCancelled) b.cancelled++;
    b.revenue += Number(link.saleAmount ?? 0);
    buckets.set(key, b);
  }

  let upserted = 0;
  for (const b of buckets.values()) {
    const existing = await db.adMetrics.findUnique({
      where: { adId_date: { adId: b.adId, date: b.date } },
    });
    if (!existing) {
      // No cost row yet → create one with zeros for cost/impressions/clicks.
      // It will be filled at next direct-cost sync.
      const adExists = await db.ad.findUnique({
        where: { yandexId: b.adId },
        select: { yandexId: true },
      });
      if (!adExists) continue;
      await db.adMetrics.create({
        data: {
          adId: b.adId,
          date: b.date,
          impressions: 0, clicks: 0, cost: 0, ctr: 0, avgCpc: 0,
          leads: b.leads,
          scheduled: b.scheduled,
          completed: b.completed,
          cancelled: b.cancelled,
          revenue: b.revenue,
          cpl: b.scheduled > 0 ? null : null,
          roi: null,
        },
      });
    } else {
      // Compute CPL/ROI now that we have both sides.
      const cost = Number(existing.cost);
      const cpl = b.scheduled > 0 ? cost / b.scheduled : null;
      const roi = cost > 0 ? (b.revenue - cost) / cost : null;
      await db.adMetrics.update({
        where: { adId_date: { adId: b.adId, date: b.date } },
        data: {
          leads: b.leads,
          scheduled: b.scheduled,
          completed: b.completed,
          cancelled: b.cancelled,
          revenue: b.revenue,
          cpl: cpl !== null ? Math.round(cpl * 100) / 100 : null,
          roi: roi !== null ? Math.round(roi * 10000) / 10000 : null,
          syncedAt: new Date(),
        },
      });
    }
    upserted++;
  }
  return upserted;
}

export async function syncLeads(): Promise<SyncResult> {
  const from = await getWatermark();
  const to = new Date();
  logger.info({ from, to }, 'sync-leads started');

  const { leads, upserted: yclidsUpserted, unmappable } = await syncLeadsToYclidLinks(from, to);
  const costRows = await syncDirectCostToAdMetrics(from, to);
  const crmRollup = await rollupCrmToAdMetrics(from, to);

  const result: SyncResult = {
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    leadsFetched: leads.length,
    yclidsUpserted,
    metricsUpserted: costRows + crmRollup,
    unmappableLeads: unmappable,
  };
  logger.info(result, 'sync-leads done');
  return result;
}
