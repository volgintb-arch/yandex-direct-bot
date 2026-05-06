import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

export type DirectService =
  | 'campaigns'
  | 'adgroups'
  | 'ads'
  | 'keywords'
  | 'keywordsresearch'
  | 'reports'
  | 'dictionaries'
  | 'adimages'
  | 'sitelinks'
  | 'changes';

interface DirectErrorResponse {
  error: {
    error_code: number;
    error_string: string;
    error_detail?: string;
    request_id?: string;
  };
}

interface DirectSuccessResponse<T> {
  result: T;
}

type DirectResponse<T> = DirectSuccessResponse<T> | DirectErrorResponse;

export interface DirectCallOptions {
  /** Override Client-Login header (defaults to env). */
  clientLogin?: string;
  /** Disable error logging for expected failures. */
  silent?: boolean;
  /** Don't persist call to ApiCallLog (e.g. for healthchecks). */
  noLog?: boolean;
}

/**
 * Generic Yandex Direct API v5 caller.
 * Returns the `result` field on success, throws ApiError on failure.
 */
export async function direct<T = unknown>(
  service: DirectService,
  method: string,
  params: object = {},
  opts: DirectCallOptions = {}
): Promise<T> {
  const url = `${config.YANDEX_DIRECT_API_URL}/${service}`;
  const body = JSON.stringify({ method, params });
  const start = Date.now();

  let status: number | undefined;
  let errorMsg: string | undefined;
  let responseSize: number | undefined;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.YANDEX_DIRECT_TOKEN}`,
        'Client-Login': opts.clientLogin ?? config.YANDEX_DIRECT_CLIENT_LOGIN,
        'Accept-Language': 'ru',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body,
    });
    status = res.status;
    const text = await res.text();
    responseSize = text.length;

    if (!res.ok) {
      throw new ApiError(
        `Yandex Direct HTTP ${res.status}: ${text.slice(0, 200)}`,
        'yandex_direct',
        res.status
      );
    }

    const json = JSON.parse(text) as DirectResponse<T>;
    if ('error' in json) {
      throw new ApiError(
        json.error.error_string,
        'yandex_direct',
        json.error.error_code,
        json.error.error_detail,
        json.error.request_id
      );
    }

    return json.result;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    if (!opts.silent) {
      logger.error(
        { service, method, status, err: errorMsg },
        'yandex direct call failed'
      );
    }
    throw err;
  } finally {
    if (!opts.noLog) {
      void db.apiCallLog
        .create({
          data: {
            service: 'yandex_direct',
            endpoint: `${service}.${method}`,
            status,
            durationMs: Date.now() - start,
            error: errorMsg,
            requestSize: body.length,
            responseSize,
          },
        })
        .catch(() => {});
    }
  }
}

/** Convert rubles to micro-rubles (Direct internal unit). */
export const toMicros = (rub: number): number => Math.round(rub * 1_000_000);

/** Convert micro-rubles to rubles. */
export const fromMicros = (micros: number): number => micros / 1_000_000;
