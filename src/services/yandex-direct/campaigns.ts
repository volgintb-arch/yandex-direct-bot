import { direct, toMicros } from './client.js';

/** YYYY-MM-DD in Moscow timezone (Yandex Direct uses Moscow time). */
function today(): string {
  const now = new Date();
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
  const all = await listCampaigns();
  return all.find((c) => c.Name === name) ?? null;
}

export type BiddingStrategyType =
  | 'WB_MAXIMUM_CLICKS'
  | 'WB_MAXIMUM_CONVERSION_RATE'
  | 'AVERAGE_CPC'
  | 'SERVING_OFF';

export interface CreateSearchCampaignInput {
  name: string;
  dailyBudgetRub: number;
  strategy?: BiddingStrategyType; // default WB_MAXIMUM_CLICKS
  strategyBid?: number;           // for AVERAGE_CPC — desired avg CPC in rubles
}

export interface CreateNetworkCampaignInput {
  name: string;
  dailyBudgetRub: number;
  strategy?: BiddingStrategyType; // default WB_MAXIMUM_CLICKS
  strategyBid?: number;
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

/**
 * Build the BiddingStrategy object for the chosen strategy type.
 * WeeklySpendLimit = dailyBudget × 7 (Direct auto-strategies use weekly limits).
 */
function buildSideStrategy(
  strategy: BiddingStrategyType = 'WB_MAXIMUM_CLICKS',
  weeklyLimitMicros: number,
  strategyBidRub?: number
): Record<string, unknown> {
  switch (strategy) {
    case 'WB_MAXIMUM_CONVERSION_RATE':
      return {
        BiddingStrategyType: 'WB_MAXIMUM_CONVERSION_RATE',
        WbMaximumConversionRate: { WeeklySpendLimit: weeklyLimitMicros },
      };
    case 'AVERAGE_CPC':
      return {
        BiddingStrategyType: 'AVERAGE_CPC',
        AverageCpc: {
          AverageCpc: toMicros(strategyBidRub ?? 50),
          WeeklySpendLimit: weeklyLimitMicros,
        },
      };
    case 'WB_MAXIMUM_CLICKS':
    default:
      return {
        BiddingStrategyType: 'WB_MAXIMUM_CLICKS',
        WbMaximumClicks: { WeeklySpendLimit: weeklyLimitMicros },
      };
  }
}

export async function createSearchCampaign(input: CreateSearchCampaignInput): Promise<number> {
  const weeklyLimit = toMicros(input.dailyBudgetRub * 7);
  const r = await direct<AddCampaignsResponse>('campaigns', 'add', {
    Campaigns: [
      {
        Name: input.name,
        StartDate: today(),
        TextCampaign: {
          BiddingStrategy: {
            Search: buildSideStrategy(input.strategy, weeklyLimit, input.strategyBid),
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
  const weeklyLimit = toMicros(input.dailyBudgetRub * 7);
  const r = await direct<AddCampaignsResponse>('campaigns', 'add', {
    Campaigns: [
      {
        Name: input.name,
        StartDate: today(),
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: 'SERVING_OFF' },
            Network: buildSideStrategy(input.strategy, weeklyLimit, input.strategyBid),
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
