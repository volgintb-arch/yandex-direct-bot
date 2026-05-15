import { getInitData } from './tg.js';

const BASE = '/api/miniapp';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: {
      'X-Telegram-Init-Data': getInitData(),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

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

export const api = {
  me: () => request<Me>('/me'),
  dashboard: (days: number) => request<DashboardData>(`/dashboard?days=${days}`),
  campaigns: () => request<{ campaigns: Campaign[] }>('/campaigns'),
  approvals: (status = 'pending') =>
    request<{ approvals: Approval[] }>(`/approvals?status=${status}`),
  knowledge: () => request<{ entries: KnowledgeEntry[] }>('/knowledge'),
  images: () => request<{ images: ImageEntry[] }>('/images'),
};
