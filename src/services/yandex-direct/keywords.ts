import { direct } from './client.js';

interface AddKeywordsResponse {
  AddResults: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }>;
}

export async function addKeywords(
  adgroupId: number,
  keywords: string[]
): Promise<number[]> {
  if (keywords.length === 0) return [];
  const r = await direct<AddKeywordsResponse>('keywords', 'add', {
    Keywords: keywords.map((kw) => ({ AdGroupId: adgroupId, Keyword: kw })),
  });
  return (r.AddResults ?? []).map((res, i) => {
    if (!res.Id) {
      throw new Error(
        `Failed to add keyword "${keywords[i]}": ${res.Errors?.map((e) => e.Message).join('; ') ?? 'unknown'}`
      );
    }
    return res.Id;
  });
}

/** Add negative keywords at adgroup level. */
export async function setAdgroupNegativeKeywords(
  adgroupId: number,
  negatives: string[]
): Promise<void> {
  await direct('adgroups', 'update', {
    AdGroups: [
      {
        Id: adgroupId,
        NegativeKeywords: { Items: negatives },
      },
    ],
  });
}
