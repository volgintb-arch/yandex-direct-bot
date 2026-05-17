import { getInitData } from './tg.js';

const BASE = '/api/miniapp';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'X-Telegram-Init-Data': getInitData(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

export interface DashboardData {
  period: number;
  empty: boolean;
  message?: string;
  totals?: {
    impressions: number;
    clicks: number;
    cost: number;
    ctr: number;
    avgCpc: number;
  };
  crm?: {
    leads: number;
    new: number;
    inWork: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    revenue: number;
    cpl: number | null;
    roi: number | null;
    conversionRate: number;
  } | null;
  topCampaigns?: Array<{
    campaignId: number;
    campaignName: string;
    campaignType: string;
    impressions: number;
    clicks: number;
    cost: number;
    ctr: number;
    avgCpc: number;
    leads?: number;
    scheduled?: number;
    revenue?: number;
    cpl?: number | null;
    roi?: number | null;
  }>;
}

export interface Campaign {
  id: number;
  name: string;
  type: string;
  state: string;
  status: string;
  dailyBudget: number | null;
}

export interface Approval {
  id: string;
  status: string;
  campaignType: string;
  geo: string;
  dailyBudget: number;
  targetCpl: number | null;
  siteUrl: string;
  createdAt: string;
  appliedAt: string | null;
  yandexCampaignId: string | null;
  yandexAdId: string | null;
}

export interface KnowledgeEntry {
  id: number;
  type: string;
  scope: string;
  city: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ImageEntry {
  hash: string;
  name: string | null;
  description: string | null;
  url: string | null;
  format: string | null;
}

export interface Me {
  id: string;
  username: string | null;
  name: string | null;
  role: 'admin' | 'user';
}

export interface CampaignDetails {
  id: number;
  name: string;
  type: string;
  state: string;
  status: string;
  days: number;
  totals: { cost: number; clicks: number; impressions: number; ctr: number };
  crm: {
    leads: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    revenue: number;
    cpl: number | null;
    roi: number | null;
  } | null;
  series: Array<{
    date: string;
    impressions: number;
    clicks: number;
    cost: number;
    ctr: number;
  }>;
  ads: Array<{
    id: number;
    state: string;
    status: string;
    title1: string;
    title2: string | null;
    text: string;
    url: string;
  }>;
}

export interface Variant {
  variant_id: string;
  title: string;
  strategy_explanation: string;
  draft: {
    campaign_name: string;
    adgroup_name: string;
    keywords: string[];
    negative_keywords: string[];
    ad: { title1: string; title2: string; text: string; url: string };
  };
}

export const api = {
  me: () => request<Me>('/me'),
  dashboard: (days: number) => request<DashboardData>(`/dashboard?days=${days}`),
  campaigns: () => request<{ campaigns: Campaign[] }>('/campaigns'),
  campaignDetails: (id: number, days = 30) =>
    request<CampaignDetails>(`/campaigns/${id}?days=${days}`),
  approvals: (status = 'pending') =>
    request<{ approvals: Approval[] }>(`/approvals?status=${status}`),
  rejectApproval: (id: string) => post<{ ok: true }>(`/approvals/${id}/reject`),
  applyApproval: (id: string, variantId: string) =>
    post<{ ok: true; campaignId: string; adId: string; campaignCreated: boolean; adgroupCreated: boolean; keywordsAdded: number; imageAttached: boolean }>(
      `/approvals/${id}/apply`,
      { variantId }
    ),
  knowledge: () => request<{ entries: KnowledgeEntry[] }>('/knowledge'),
  addKnowledgeDocument: (input: { name: string; scope?: string; text: string; tags?: string[] }) =>
    post<{ ok: true }>('/knowledge/document', input),
  deleteKnowledge: (id: number) => post<{ ok: true }>(`/knowledge/${id}/delete`),
  editKnowledge: (id: number, patch: { name?: string; text?: string; rules?: string; scope?: string }) =>
    post<{ ok: true }>(`/knowledge/${id}/edit`, patch),
  optimizeCampaign: (id: number, days = 30) =>
    post<{ tips: string }>(`/campaigns/${id}/optimize?days=${days}`),
  approvalDetails: (id: string) =>
    request<{
      id: string;
      status: string;
      campaignType: string;
      geo: string;
      dailyBudget: number;
      targetCpl: number | null;
      siteUrl: string;
      selectedVariantId: string | null;
      variants: Variant[];
      selectedImageHashes: string[];
      createdAt: string;
    }>(`/approvals/${id}`),
  reviseApproval: (id: string, variantId: string, revisionText: string) =>
    post<{ ok: true; variant: Variant }>(`/approvals/${id}/revise`, { variantId, revisionText }),
  images: () => request<{ images: ImageEntry[] }>('/images'),
  uploadImage: (dataUrl: string, name?: string) =>
    post<{ hash: string; width: number; height: number; target: string }>('/upload-image', {
      dataUrl,
      name,
    }),
  createCampaign: (input: {
    kind: 'search' | 'network';
    geo: string;
    budget: number;
    cpl?: number;
    url?: string;
    brief: string;
    imageHash?: string | null;
  }) =>
    post<{ approvalId: string; cpl: number; variants: Variant[] }>('/create-campaign', input),
};
