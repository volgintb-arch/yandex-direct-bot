import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { validateInitData } from '../lib/telegram-init-data.js';
import { loadAnalyticsContext } from '../services/ai/analytics-builder.js';
import { listCampaigns } from '../services/yandex-direct/campaigns.js';

/**
 * Read-only API for the Telegram Mini App. Auth: header "X-Telegram-Init-Data"
 * with the raw initData string from window.Telegram.WebApp.initData.
 *
 * Routes are mounted under /api/miniapp.
 */

const app = new Hono<{ Variables: { tgUserId: number; isAdmin: boolean } }>();

// CORS — Telegram WebApp may load us from various Telegram origins.
app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'X-Telegram-Init-Data'] }));

// Auth middleware
app.use('*', async (c, next) => {
  const initData = c.req.header('X-Telegram-Init-Data') ?? '';
  const parsed = validateInitData(initData);
  if (!parsed) {
    return c.json({ error: 'Invalid or missing initData' }, 401);
  }
  // Whitelist check
  const user = await db.authorizedUser.findUnique({
    where: { telegramId: BigInt(parsed.user.id) },
  });
  if (!user) {
    return c.json({ error: 'Not authorized' }, 403);
  }
  c.set('tgUserId', parsed.user.id);
  c.set('isAdmin', user.role === 'admin');
  await next();
});

/* ───── /api/miniapp/me ───── */
app.get('/me', async (c) => {
  const userId = c.get('tgUserId');
  const user = await db.authorizedUser.findUnique({
    where: { telegramId: BigInt(userId) },
    select: { telegramId: true, username: true, firstName: true, role: true },
  });
  return c.json({
    id: user!.telegramId.toString(),
    username: user!.username,
    name: user!.firstName,
    role: user!.role,
  });
});

/* ───── /api/miniapp/dashboard?days=7 ───── */
app.get('/dashboard', async (c) => {
  const days = parseInt(c.req.query('days') ?? '7', 10) || 7;
  try {
    const ctx = await loadAnalyticsContext(days);
    if (!ctx) {
      return c.json({
        period: days,
        empty: true,
        message: 'Нет активных кампаний или данных за период',
      });
    }
    return c.json({
      period: days,
      empty: false,
      totals: {
        impressions: ctx.totalImpressions,
        clicks: ctx.totalClicks,
        cost: ctx.totalCost,
        ctr: ctx.avgCtr,
        avgCpc: ctx.avgCpc,
      },
      crm: ctx.totalLeads
        ? {
            leads: ctx.totalLeads,
            new: ctx.totalNew,
            inWork: ctx.totalInWork,
            scheduled: ctx.totalScheduled,
            completed: ctx.totalCompleted,
            cancelled: ctx.totalCancelled,
            revenue: ctx.totalRevenue,
            cpl: ctx.cpl,
            roi: ctx.roi,
            conversionRate: ctx.conversionRate,
          }
        : null,
      topCampaigns: ctx.campaigns.slice(0, 10),
    });
  } catch (err) {
    logger.error({ err }, 'miniapp dashboard failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/* ───── /api/miniapp/campaigns ───── */
app.get('/campaigns', async (c) => {
  try {
    const remote = await listCampaigns({ states: ['ON', 'SUSPENDED', 'OFF'] });
    return c.json({
      campaigns: remote.map((cmp) => ({
        id: cmp.Id,
        name: cmp.Name,
        type: cmp.Type,
        state: cmp.State,
        status: cmp.Status,
        dailyBudget: cmp.DailyBudget?.Amount ? cmp.DailyBudget.Amount / 1_000_000 : null,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'miniapp campaigns failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/* ───── /api/miniapp/approvals ───── */
app.get('/approvals', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const rows = await db.approval.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      campaignType: true,
      geo: true,
      dailyBudget: true,
      targetCpl: true,
      siteUrl: true,
      createdAt: true,
      appliedAt: true,
      yandexCampaignId: true,
      yandexAdId: true,
    },
  });
  return c.json({
    approvals: rows.map((r) => ({
      ...r,
      yandexCampaignId: r.yandexCampaignId?.toString() ?? null,
      yandexAdId: r.yandexAdId?.toString() ?? null,
    })),
  });
});

/* ───── /api/miniapp/knowledge ───── */
app.get('/knowledge', async (c) => {
  const entries = await db.knowledgeEntry.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return c.json({ entries });
});

/* ───── /api/miniapp/images ───── */
app.get('/images', async (c) => {
  const images = await db.yandexImage.findMany({
    orderBy: { syncedAt: 'desc' },
    take: 50,
    select: { hash: true, name: true, description: true, url: true, format: true },
  });
  return c.json({ images });
});

export default app;
