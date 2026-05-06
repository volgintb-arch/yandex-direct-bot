import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

export type ReportType =
  | 'CUSTOM_REPORT'
  | 'AD_PERFORMANCE_REPORT'
  | 'CAMPAIGN_PERFORMANCE_REPORT'
  | 'ADGROUP_PERFORMANCE_REPORT'
  | 'SEARCH_QUERY_PERFORMANCE_REPORT';

export type DateRangePreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'LAST_365_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'CUSTOM_DATE';

export interface ReportRequest {
  reportName: string;
  reportType: ReportType;
  fieldNames: string[];
  dateRange: DateRangePreset;
  dateFrom?: string; // YYYY-MM-DD, only with CUSTOM_DATE
  dateTo?: string;
  filter?: { campaignIds?: number[]; adIds?: number[]; adgroupIds?: number[] };
}

/**
 * Yandex Direct Reports API uses async + polling mechanism with TSV response.
 * 1) POST request with `processingMode: auto`
 * 2) If 200 — body is TSV. If 201/202 — wait for retryIn header and re-poll.
 *
 * Returns parsed rows as objects keyed by fieldNames.
 */
export async function fetchReport(req: ReportRequest): Promise<Record<string, string>[]> {
  const url = `${config.YANDEX_DIRECT_API_URL}/reports`;
  const start = Date.now();

  const body = JSON.stringify({
    params: {
      SelectionCriteria: {
        ...(req.filter?.campaignIds && { Filter: buildFilter(req.filter) }),
        ...(req.dateRange === 'CUSTOM_DATE' && {
          DateFrom: req.dateFrom,
          DateTo: req.dateTo,
        }),
      },
      FieldNames: req.fieldNames,
      ReportName: req.reportName,
      ReportType: req.reportType,
      DateRangeType: req.dateRange,
      Format: 'TSV',
      IncludeVAT: 'YES',
    },
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.YANDEX_DIRECT_TOKEN}`,
    'Client-Login': config.YANDEX_DIRECT_CLIENT_LOGIN,
    'Accept-Language': 'ru',
    processingMode: 'auto',
    returnMoneyInMicros: 'false',
    skipReportHeader: 'true',
    skipReportSummary: 'true',
    'Content-Type': 'application/json; charset=utf-8',
  };

  const MAX_ATTEMPTS = 20;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: 'POST', headers, body });
    if (res.status === 200) {
      const tsv = await res.text();
      const rows = parseTsv(tsv, req.fieldNames);
      void logCall(start, 200, rows.length);
      return rows;
    }
    if (res.status === 201 || res.status === 202) {
      const retry = parseInt(res.headers.get('retryIn') ?? '5', 10);
      logger.debug({ attempt, retry, status: res.status }, 'report processing, will retry');
      await sleep(retry * 1000);
      continue;
    }
    const text = await res.text();
    void logCall(start, res.status);
    throw new ApiError(
      `Reports API HTTP ${res.status}: ${text.slice(0, 200)}`,
      'yandex_direct',
      res.status
    );
  }
  throw new ApiError('Reports API: timeout waiting for report', 'yandex_direct');
}

function buildFilter(filter: ReportRequest['filter']) {
  if (!filter) return undefined;
  const items: Array<{ Field: string; Operator: string; Values: string[] }> = [];
  if (filter.campaignIds?.length) {
    items.push({ Field: 'CampaignId', Operator: 'IN', Values: filter.campaignIds.map(String) });
  }
  if (filter.adIds?.length) {
    items.push({ Field: 'AdId', Operator: 'IN', Values: filter.adIds.map(String) });
  }
  if (filter.adgroupIds?.length) {
    items.push({ Field: 'AdGroupId', Operator: 'IN', Values: filter.adgroupIds.map(String) });
  }
  return items;
}

function parseTsv(tsv: string, fields: string[]): Record<string, string>[] {
  const lines = tsv.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    fields.forEach((f, i) => {
      row[f] = cells[i] ?? '';
    });
    return row;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function logCall(start: number, status: number, rows?: number) {
  await db.apiCallLog
    .create({
      data: {
        service: 'yandex_direct',
        endpoint: 'reports.get',
        status,
        durationMs: Date.now() - start,
        responseSize: rows,
      },
    })
    .catch(() => {});
}
