import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

export interface WordstatRequestItem {
  phrase: string;
  count: number; // показов в месяц
}

export interface WordstatResponse {
  topRequests: WordstatRequestItem[];
  includingPhrases?: WordstatRequestItem[];
}

/** Get top search queries similar to a phrase from Yandex Wordstat. */
export async function getTopRequests(
  phrase: string,
  regionIds: number[] = []
): Promise<WordstatResponse> {
  const url = `${config.YANDEX_WORDSTAT_API_URL}/topRequests`;
  const payload: Record<string, unknown> = { phrase };
  if (regionIds.length > 0) payload.regions = regionIds;
  const body = JSON.stringify(payload);
  const start = Date.now();
  let status: number | undefined;
  let errorMsg: string | undefined;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.YANDEX_WORDSTAT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body,
    });
    status = res.status;

    if (!res.ok) {
      const txt = await res.text();
      throw new ApiError(
        `Wordstat HTTP ${res.status}: ${txt.slice(0, 200)}`,
        'wordstat',
        res.status
      );
    }

    return (await res.json()) as WordstatResponse;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ phrase, regionIds, status, err: errorMsg }, 'wordstat call failed');
    throw err;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'wordstat',
          endpoint: 'topRequests',
          status,
          durationMs: Date.now() - start,
          error: errorMsg,
          requestSize: body.length,
        },
      })
      .catch(() => {});
  }
}

/** Quick health check — phrase that should always return results. */
export async function ping(): Promise<boolean> {
  try {
    const r = await getTopRequests('квест', []);
    return Array.isArray(r.topRequests);
  } catch {
    return false;
  }
}
