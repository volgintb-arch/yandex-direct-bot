import { direct } from './client.js';

export interface AdSummary {
  Id: number;
  AdGroupId: number;
  CampaignId: number;
  Type: string;
  State: string;
  Status: string;
  TextAd?: { Title: string; Title2?: string; Text: string; Href: string };
  TextImageAd?: { Title: string; Title2?: string; Text: string; Href: string; AdImageHash: string };
}

interface GetAdsResponse {
  Ads?: AdSummary[];
}

export async function listAds(filter: {
  ids?: number[];
  campaignIds?: number[];
  adgroupIds?: number[];
}): Promise<AdSummary[]> {
  const params: Record<string, unknown> = {
    SelectionCriteria: {},
    FieldNames: ['Id', 'AdGroupId', 'CampaignId', 'Type', 'State', 'Status'],
    TextAdFieldNames: ['Title', 'Title2', 'Text', 'Href'],
    TextImageAdFieldNames: ['Title', 'Title2', 'Text', 'Href', 'AdImageHash'],
  };
  const sel = params.SelectionCriteria as Record<string, unknown>;
  if (filter.ids) sel.Ids = filter.ids;
  if (filter.campaignIds) sel.CampaignIds = filter.campaignIds;
  if (filter.adgroupIds) sel.AdGroupIds = filter.adgroupIds;

  const r = await direct<GetAdsResponse>('ads', 'get', params);
  return r.Ads ?? [];
}

interface AddAdsResponse {
  AddResults: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }>;
}

export interface CreateTextAdInput {
  adgroupId: number;
  title1: string;
  title2?: string;
  text: string;
  href: string;
}

export async function createTextAd(input: CreateTextAdInput): Promise<number> {
  const r = await direct<AddAdsResponse>('ads', 'add', {
    Ads: [
      {
        AdGroupId: input.adgroupId,
        TextAd: {
          Title: input.title1,
          Title2: input.title2,
          Text: input.text,
          Href: input.href,
        },
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(
      `Failed to create ad: ${result?.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
    );
  }
  return result.Id;
}

export interface CreateTextImageAdInput extends CreateTextAdInput {
  adImageHash: string;
}

export async function createTextImageAd(input: CreateTextImageAdInput): Promise<number> {
  const r = await direct<AddAdsResponse>('ads', 'add', {
    Ads: [
      {
        AdGroupId: input.adgroupId,
        TextImageAd: {
          Title: input.title1,
          Title2: input.title2,
          Text: input.text,
          Href: input.href,
          AdImageHash: input.adImageHash,
        },
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(
      `Failed to create text-image ad: ${result?.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
    );
  }
  return result.Id;
}
