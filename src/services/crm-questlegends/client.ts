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
