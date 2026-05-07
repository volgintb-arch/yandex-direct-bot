import { direct, toMicros } from './client.js';

/** YYYY-MM-DD in Moscow timezone (Yandex Direct uses Moscow time). */
function today(): string {
  const now = new Date();
  // Convert to MSK (UTC+3)
  const msk = new Date(now.getTime() + 3 * 3600 * 1000);
  return msk.toISOString().slice(0, 10);
}

export interface CampaignSummary {
  Id: number;
  Name: string;
  Type: string; // TEXT_CAMPAIGN | UNIFIED_CAMPAIGN | ...
  State: string; // ON | OFF | SUSPENDED | ARCHIVED | ENDED | CONVERTED
  Status: string; // ACCEPTED | DRAFT | MODERATION | REJECTED
  StatusPayment?: string;
  DailyBudget?: { Amount: number; Mode: string };
}

interface GetCampaignsResponse {
  Campaigns?: CampaignSummary[];
}

export async function listCampaigns(filter?: {
  states?: string[];
  ids?: number[];
}): Promise<CampaignSummary[]> {
  const params: Record<string, unknown> = {
    SelectionCriteria: {},
    FieldNames: ['Id', 'Name', 'Type', 'State', 'Status', 'StatusPayment', 'DailyBudget'],
  };
  if (filter?.states) (params.SelectionCriteria as Record<string, unknown>).States = filter.states;
  if (filter?.ids) (params.SelectionCriteria as Record<string, unknown>).Ids = filter.ids;

  const r = await direct<GetCampaignsResponse>('campaigns', 'get', params);
  return r.Campaigns ?? [];
}

export async function findCampaignByName(name: string): Promise<CampaignSummary | null> {
  // Direct API doesn't filter by name — fetch all & filter locally.
  const all = await listCampaigns();
  return all.find((c) => c.Name === name) ?? null;
}

export type BiddingStrategyType =
  | 'WB_MAXIMUM_CLICKS'
  | 'WB_MAXIMUM_CONVERSION_RATE'
  | 'WB_MAXIMUM_IMPRESSIONS'
  | 'AVERAGE_CPC'
  | 'AVERAGE_CPA'
  | 'SERVING_OFF';

export interface CreateSearchCampaignInput {
  name: string;
  dailyBudgetRub: number;
  searchStrategy?: BiddingStrategyType; // default WB_MAXIMUM_CLICKS
}

export interface CreateNetworkCampaignInput {
  name: string;
  dailyBudgetRub: number;
  networkStrategy?: BiddingStrategyType; // default WB_MAXIMUM_CLICKS
}

interface DirectError {
  Code: number;
  Message: string;
  Details?: string;
}

interface AddCampaignsResponse {
  AddResults: Array<{
    Id?: number;
    Errors?: DirectError[];
    Warnings?: DirectError[];
  }>;
}

function formatErrors(errors?: DirectError[]): string {
  if (!errors || errors.length === 0) return 'unknown';
  return errors
    .map((e) => `[${e.Code}] ${e.Message}${e.Details ? ' — ' + e.Details : ''}`)
    .join('; ');
}

export async function createSearchCampaign(input: CreateSearchCampaignInput): Promise<number> {
  // Auto-strategy WB_MAXIMUM_CLICKS uses WeeklySpendLimit; DailyBudget is
  // mutually exclusive with auto-strategies (Direct error 6000).
  const r = await direct<AddCampaignsResponse>('campaigns', 'add', {
    Campaigns: [
      {
        Name: input.name,
        StartDate: today(),
        TextCampaign: {
          BiddingStrategy: {
            Search: {
              BiddingStrategyType: 'WB_MAXIMUM_CLICKS',
              WbMaximumClicks: {
                WeeklySpendLimit: toMicros(input.dailyBudgetRub * 7),
              },
            },
            Network: { BiddingStrategyType: 'SERVING_OFF' },
          },
        },
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(`Failed to create campaign: ${formatErrors(result?.Errors)}`);
  }
  return result.Id;
}

export async function createNetworkCampaign(input: CreateNetworkCampaignInput): Promise<number> {
  const r = await direct<AddCampaignsResponse>('campaigns', 'add', {
    Campaigns: [
      {
        Name: input.name,
        StartDate: today(),
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: 'SERVING_OFF' },
            Network: {
              BiddingStrategyType: 'WB_MAXIMUM_CLICKS',
              WbMaximumClicks: {
                WeeklySpendLimit: toMicros(input.dailyBudgetRub * 7),
              },
            },
          },
        },
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(`Failed to create campaign: ${formatErrors(result?.Errors)}`);
  }
  return result.Id;
}
