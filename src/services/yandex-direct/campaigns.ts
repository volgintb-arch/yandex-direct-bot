import { direct, toMicros } from './client.js';

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

interface AddCampaignsResponse {
  AddResults: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }>;
}

export async function createSearchCampaign(input: CreateSearchCampaignInput): Promise<number> {
  const r = await direct<AddCampaignsResponse>('campaigns', 'add', {
    Campaigns: [
      {
        Name: input.name,
        DailyBudget: { Amount: toMicros(input.dailyBudgetRub), Mode: 'STANDARD' },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: input.searchStrategy ?? 'WB_MAXIMUM_CLICKS' },
            Network: { BiddingStrategyType: 'SERVING_OFF' },
          },
        },
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(
      `Failed to create campaign: ${result?.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
    );
  }
  return result.Id;
}

export async function createNetworkCampaign(input: CreateNetworkCampaignInput): Promise<number> {
  const r = await direct<AddCampaignsResponse>('campaigns', 'add', {
    Campaigns: [
      {
        Name: input.name,
        DailyBudget: { Amount: toMicros(input.dailyBudgetRub), Mode: 'STANDARD' },
        TextCampaign: {
          BiddingStrategy: {
            Search: { BiddingStrategyType: 'SERVING_OFF' },
            Network: { BiddingStrategyType: input.networkStrategy ?? 'WB_MAXIMUM_CLICKS' },
          },
        },
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(
      `Failed to create campaign: ${result?.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
    );
  }
  return result.Id;
}
