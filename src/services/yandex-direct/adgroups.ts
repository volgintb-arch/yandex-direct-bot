import { direct } from './client.js';

export interface AdgroupSummary {
  Id: number;
  CampaignId: number;
  Name: string;
  RegionIds: number[];
  Type: string;
  Status: string;
}

interface GetAdgroupsResponse {
  AdGroups?: AdgroupSummary[];
}

export async function listAdgroups(filter: {
  campaignIds?: number[];
  ids?: number[];
}): Promise<AdgroupSummary[]> {
  const params: Record<string, unknown> = {
    SelectionCriteria: {},
    FieldNames: ['Id', 'CampaignId', 'Name', 'RegionIds', 'Type', 'Status'],
  };
  const sel = params.SelectionCriteria as Record<string, unknown>;
  if (filter.campaignIds) sel.CampaignIds = filter.campaignIds;
  if (filter.ids) sel.Ids = filter.ids;

  const r = await direct<GetAdgroupsResponse>('adgroups', 'get', params);
  return r.AdGroups ?? [];
}

export async function findAdgroupByName(
  campaignId: number,
  name: string
): Promise<AdgroupSummary | null> {
  const all = await listAdgroups({ campaignIds: [campaignId] });
  return all.find((g) => g.Name === name) ?? null;
}

interface AddAdgroupsResponse {
  AddResults: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }>;
}

export async function createAdgroup(input: {
  name: string;
  campaignId: number;
  regionIds: number[];
}): Promise<number> {
  const r = await direct<AddAdgroupsResponse>('adgroups', 'add', {
    AdGroups: [
      {
        Name: input.name,
        CampaignId: input.campaignId,
        RegionIds: input.regionIds,
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.Id) {
    throw new Error(
      `Failed to create adgroup: ${result?.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
    );
  }
  return result.Id;
}
