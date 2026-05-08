import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

export type LeadStatus = 'new' | 'scheduled' | 'completed' | 'cancelled';

export interface CrmLead {
  yclid: string;
  leadId: string;
  leadType: 'deal' | 'game_lead';
  status: LeadStatus;
  stageType: string;
  city: string | null;
  createdAt: string;
  scheduledAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  revenue: number | null;
  currency: string;
  source: string;
}

export interface ByYclidResponse {
  leads: CrmLead[];
  notFound: string[];
  meta: { requested: number; found: number; queriedAt: string };
}

const MAX_PER_REQUEST = 500;

/**
 * Fetch leads by yclid array. Auto-batches if more than 500.
 * Returns flattened result.
 */
export async function fetchLeadsByYclids(
  yclids: string[]
): Promise<{ leads: CrmLead[]; notFound: string[] }> {
  if (yclids.length === 0) return { leads: [], notFound: [] };

  const batches: string[][] = [];
  for (let i = 0; i < yclids.length; i += MAX_PER_REQUEST) {
    batches.push(yclids.slice(i, i + MAX_PER_REQUEST));
  }

  const allLeads: CrmLead[] = [];
  const allNotFound: string[] = [];

  for (const batch of batches) {
    const r = await fetchBatch(batch);
    allLeads.push(...r.leads);
    allNotFound.push(...r.notFound);
  }

  return { leads: allLeads, notFound: allNotFound };
}

async function fetchBatch(yclids: string[]): Promise<ByYclidResponse> {
  const url = new URL('/api/leads/by-yclid', config.CRM_BASE_URL);
  url.searchParams.set('yclids', yclids.join(','));
  const start = Date.now();
  let status: number | undefined;
  let errorMsg: string | undefined;
  let responseSize: number | undefined;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.CRM_INTEGRATION_API_KEY}`,
        Accept: 'application/json',
      },
    });
    status = res.status;
    const text = await res.text();
    responseSize = text.length;

    if (!res.ok) {
      throw new ApiError(
        `CRM by-yclid HTTP ${res.status}: ${text.slice(0, 200)}`,
        'crm',
        res.status
      );
    }
    return JSON.parse(text) as ByYclidResponse;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ batchSize: yclids.length, status, err: errorMsg }, 'crm fetch failed');
    throw err;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'crm',
          endpoint: 'GET /api/leads/by-yclid',
          status,
          durationMs: Date.now() - start,
          error: errorMsg,
          responseSize,
        },
      })
      .catch(() => {});
  }
}

/** Health check — empty request should return 200. */
export async function ping(): Promise<boolean> {
  try {
    const r = await fetchBatch(['__ping__']);
    return Array.isArray(r.leads) && Array.isArray(r.notFound);
  } catch {
    return false;
  }
}

export interface RecentLead extends CrmLead {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  gclid: string | null;
  cancellationReason: string | null;
}

interface RecentLeadsResponse {
  leads: RecentLead[];
  meta: { from: string; to: string; total: number; limit: number };
}

export interface FetchRecentOpts {
  from: string; // ISO
  to: string;
  utmSource?: string;
  utmCampaign?: string;
  type?: 'b2b' | 'b2c';
  limit?: number;
}

/** Pull all leads in a period (from QL OS /api/leads/recent). */
export async function fetchRecentLeads(opts: FetchRecentOpts): Promise<RecentLead[]> {
  const url = new URL('/api/leads/recent', config.CRM_BASE_URL);
  url.searchParams.set('from', opts.from);
  url.searchParams.set('to', opts.to);
  if (opts.utmSource) url.searchParams.set('utm_source', opts.utmSource);
  if (opts.utmCampaign) url.searchParams.set('utm_campaign', opts.utmCampaign);
  if (opts.type) url.searchParams.set('type', opts.type);
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));

  const start = Date.now();
  let status: number | undefined;
  let errorMsg: string | undefined;
  let responseSize: number | undefined;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.CRM_INTEGRATION_API_KEY}`,
        Accept: 'application/json',
      },
    });
    status = res.status;
    const text = await res.text();
    responseSize = text.length;
    if (!res.ok) {
      throw new ApiError(
        `CRM /recent HTTP ${res.status}: ${text.slice(0, 200)}`,
        'crm',
        res.status
      );
    }
    const json = JSON.parse(text) as RecentLeadsResponse;
    return json.leads ?? [];
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMsg, opts }, 'crm /recent failed');
    throw err;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'crm',
          endpoint: 'GET /api/leads/recent',
          status,
          durationMs: Date.now() - start,
          error: errorMsg,
          responseSize,
        },
      })
      .catch(() => {});
  }
}
