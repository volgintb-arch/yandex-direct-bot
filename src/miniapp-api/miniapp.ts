import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { validateInitData } from '../lib/telegram-init-data.js';
import { loadAnalyticsContext } from '../services/ai/analytics-builder.js';
import { listCampaigns } from '../services/yandex-direct/campaigns.js';
import { listAds } from '../services/yandex-direct/ads.js';
import { fetchReport } from '../services/yandex-direct/reports.js';
import { fetchRecentLeads } from '../services/crm-questlegends/client.js';

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

/* ───── /api/miniapp/campaigns/:id?days=N ───── */
app.get('/campaigns/:id', async (c) => {
  const campaignId = parseInt(c.req.param('id'), 10);
  if (!campaignId || isNaN(campaignId)) return c.json({ error: 'bad campaign id' }, 400);
  const days = parseInt(c.req.query('days') ?? '30', 10) || 30;
  const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000);
  const toDate = new Date();

  try {
    const all = await listCampaigns({ ids: [campaignId] });
    const meta = all[0];
    if (!meta) return c.json({ error: 'campaign not found' }, 404);

    const [perDayRows, ads, allYandexLeads] = await Promise.all([
      fetchReport({
        reportName: `mini-camp-${campaignId}-${Date.now()}`,
        reportType: 'CAMPAIGN_PERFORMANCE_REPORT',
        dateRange: 'CUSTOM_DATE',
        dateFrom: fromDate.toISOString().slice(0, 10),
        dateTo: toDate.toISOString().slice(0, 10),
        fieldNames: ['Date', 'Impressions', 'Clicks', 'Cost', 'Ctr', 'AvgCpc'],
        filter: { campaignIds: [campaignId] },
      }),
      listAds({ campaignIds: [campaignId] }),
      fetchRecentLeads({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        utmSource: 'yandex',
        limit: 5000,
      }).catch(() => []),
    ]);

    // Fuzzy match leads to this campaign by name / id (utm_campaign in CRM
    // may differ from Direct CampaignName).
    const normalize = (s: string | null | undefined) =>
      (s ?? '').toLowerCase().replace(/[\s\-—_]+/g, '');
    const directKey = normalize(meta.Name);
    const adIds = new Set(ads.map((a) => String(a.Id)));
    const leads = allYandexLeads.filter((l) => {
      const utmKey = normalize(l.utm_campaign);
      if (utmKey && (utmKey === directKey || utmKey.includes(directKey) || directKey.includes(utmKey)))
        return true;
      // Fallback: match via utm_content = ad_id of this campaign
      if (l.utm_content && adIds.has(l.utm_content)) return true;
      return false;
    });

    const series = perDayRows
      .map((r) => ({
        date: r.Date ?? '',
        impressions: parseInt(r.Impressions ?? '0', 10) || 0,
        clicks: parseInt(r.Clicks ?? '0', 10) || 0,
        cost: parseFloat(r.Cost ?? '0') || 0,
        ctr: parseFloat(r.Ctr ?? '0') || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totals = series.reduce(
      (a, x) => ({
        impressions: a.impressions + x.impressions,
        clicks: a.clicks + x.clicks,
        cost: a.cost + x.cost,
      }),
      { impressions: 0, clicks: 0, cost: 0 }
    );

    let crm = null;
    if (leads.length > 0) {
      let scheduled = 0, completed = 0, cancelled = 0, revenue = 0;
      for (const l of leads) {
        if (l.status === 'cancelled') cancelled++;
        else if (l.status === 'completed') { completed++; scheduled++; revenue += Number(l.revenue ?? 0); }
        else if (l.status === 'scheduled') { scheduled++; revenue += Number(l.revenue ?? 0); }
      }
      crm = {
        leads: leads.length,
        scheduled, completed, cancelled,
        revenue: Math.round(revenue * 100) / 100,
        cpl: scheduled > 0 ? Math.round((totals.cost / scheduled) * 100) / 100 : null,
        roi: totals.cost > 0 ? Math.round(((revenue - totals.cost) / totals.cost) * 10000) / 10000 : null,
      };
    }

    return c.json({
      id: campaignId,
      name: meta.Name,
      type: meta.Type,
      state: meta.State,
      status: meta.Status,
      days,
      totals: {
        cost: Math.round(totals.cost * 100) / 100,
        clicks: totals.clicks,
        impressions: totals.impressions,
        ctr: totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : 0,
      },
      crm,
      series,
      ads: ads.slice(0, 50).map((a) => {
        const t = a.TextAd ?? a.TextImageAd;
        return {
          id: a.Id,
          state: a.State,
          status: a.Status,
          title1: t?.Title ?? '',
          title2: t?.Title2 ?? null,
          text: t?.Text ?? '',
          url: t?.Href ?? '',
        };
      }),
    });
  } catch (err) {
    logger.error({ err, campaignId }, 'campaign details failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/* ───── POST /api/miniapp/campaigns/:id/optimize ───── */
app.post('/campaigns/:id/optimize', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'bad id' }, 400);
  const days = parseInt(c.req.query('days') ?? '30', 10) || 30;
  try {
    const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000);
    const toDate = new Date();
    const [all, perDay, perAd, allLeads] = await Promise.all([
      listCampaigns({ ids: [id] }),
      fetchReport({
        reportName: `opt-camp-${id}-${Date.now()}`,
        reportType: 'CAMPAIGN_PERFORMANCE_REPORT',
        dateRange: 'CUSTOM_DATE',
        dateFrom: fromDate.toISOString().slice(0, 10),
        dateTo: toDate.toISOString().slice(0, 10),
        fieldNames: ['Impressions', 'Clicks', 'Cost', 'Ctr', 'AvgCpc'],
        filter: { campaignIds: [id] },
      }),
      fetchReport({
        reportName: `opt-ads-${id}-${Date.now()}`,
        reportType: 'AD_PERFORMANCE_REPORT',
        dateRange: 'CUSTOM_DATE',
        dateFrom: fromDate.toISOString().slice(0, 10),
        dateTo: toDate.toISOString().slice(0, 10),
        fieldNames: ['AdId', 'Impressions', 'Clicks', 'Cost', 'Ctr'],
        filter: { campaignIds: [id] },
      }),
      fetchRecentLeads({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        utmSource: 'yandex',
        limit: 5000,
      }).catch(() => []),
    ]);
    const meta = all[0];
    if (!meta) return c.json({ error: 'campaign not found' }, 404);
    const ads = await listAds({ campaignIds: [id] });

    const normalize = (s: string | null | undefined) =>
      (s ?? '').toLowerCase().replace(/[\s\-—_]+/g, '');
    const directKey = normalize(meta.Name);
    const adIds = new Set(ads.map((a) => String(a.Id)));
    const leads = allLeads.filter((l) => {
      const utmKey = normalize(l.utm_campaign);
      if (utmKey && (utmKey === directKey || utmKey.includes(directKey) || directKey.includes(utmKey)))
        return true;
      if (l.utm_content && adIds.has(l.utm_content)) return true;
      return false;
    });

    const totals = perDay.reduce(
      (a, r) => ({
        impressions: a.impressions + (parseInt(r.Impressions ?? '0', 10) || 0),
        clicks: a.clicks + (parseInt(r.Clicks ?? '0', 10) || 0),
        cost: a.cost + (parseFloat(r.Cost ?? '0') || 0),
      }),
      { impressions: 0, clicks: 0, cost: 0 }
    );
    let scheduled = 0, completed = 0, cancelled = 0, revenue = 0;
    for (const l of leads) {
      if (l.status === 'cancelled') cancelled++;
      else if (l.status === 'completed') { completed++; scheduled++; revenue += Number(l.revenue ?? 0); }
      else if (l.status === 'scheduled') { scheduled++; revenue += Number(l.revenue ?? 0); }
    }

    const adById = new Map(ads.map((a) => [a.Id, a]));
    const adRows = perAd.map((r) => {
      const aid = parseInt(r.AdId ?? '0', 10);
      const a = adById.get(aid);
      const t = a?.TextAd ?? a?.TextImageAd;
      return {
        id: aid,
        title1: t?.Title ?? '?',
        title2: t?.Title2 ?? null,
        text: t?.Text ?? '?',
        cost: parseFloat(r.Cost ?? '0') || 0,
        clicks: parseInt(r.Clicks ?? '0', 10) || 0,
        ctr: parseFloat(r.Ctr ?? '0') || 0,
      };
    });

    const ygpt = await import('../services/ai/yandex-gpt.js');
    const prompt = `Ты — маркетолог. Дай 5-7 конкретных рекомендаций по оптимизации этой кампании за ${days} дней.

КАМПАНИЯ: ${meta.Name} (${meta.Type}, ${meta.State})
СВОДКА:
  Показов: ${totals.impressions.toLocaleString('ru-RU')}
  Кликов: ${totals.clicks}
  CTR: ${totals.impressions ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : 0}%
  Расход: ${totals.cost.toFixed(2)}₽
  Лидов: ${leads.length}  ·  Оплачено: ${scheduled}  ·  Завершено: ${completed}  ·  Отказы: ${cancelled}
  Выручка: ${revenue.toFixed(2)}₽
  CPL: ${scheduled > 0 ? Math.round((totals.cost / scheduled) * 100) / 100 : '—'}₽
  ROI: ${totals.cost > 0 ? Math.round(((revenue - totals.cost) / totals.cost) * 100) : '—'}%

ПО ОБЪЯВЛЕНИЯМ (cost/CTR/кликов):
${adRows
  .slice(0, 10)
  .map((a, i) => `  ${i + 1}. "${a.title1}" — ${a.cost.toFixed(0)}₽ · CTR ${a.ctr}% · ${a.clicks} кл`)
  .join('\n')}

Рекомендации:
- Каждый пункт с эмодзи в начале
- Конкретные действия (остановить, снизить ставку, переписать заголовок, добавить минус-слова и т.п.)
- Если что-то приносит прибыль — отдельный пункт «масштабировать это»
- Markdown, без JSON`;

    const system = 'Ты — маркетолог. Никаких ограничений на разбор технических метрик бизнеса.';
    let tips = '';
    try {
      tips = await ygpt.generate('pro', { system, prompt, temperature: 0.4, maxTokens: 2500 });
    } catch (err) {
      logger.warn({ err }, 'optimize Pro failed, trying Lite');
      try { tips = await ygpt.generate('lite', { system, prompt, temperature: 0.4, maxTokens: 2000 }); }
      catch (e) { logger.warn({ err: e }, 'optimize Lite failed'); }
    }
    return c.json({ campaignId: id, days, tips: tips || 'ИИ не смог сгенерировать.' });
  } catch (err) {
    logger.error({ err, id }, 'optimize failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/* ───── /api/miniapp/approvals/:id ───── */
app.get('/approvals/:id', async (c) => {
  const id = c.req.param('id');
  const a = await db.approval.findUnique({ where: { id } });
  if (!a) return c.json({ error: 'not found' }, 404);
  return c.json({
    id: a.id,
    status: a.status,
    campaignType: a.campaignType,
    geo: a.geo,
    dailyBudget: a.dailyBudget,
    targetCpl: a.targetCpl,
    siteUrl: a.siteUrl,
    selectedVariantId: a.selectedVariantId,
    variants: a.variants,
    selectedImageHashes: a.selectedImageHashes,
    createdAt: a.createdAt,
    appliedAt: a.appliedAt,
    yandexCampaignId: a.yandexCampaignId?.toString() ?? null,
    yandexAdId: a.yandexAdId?.toString() ?? null,
  });
});

/* ───── POST /api/miniapp/approvals/:id/revise ─────
 * Apply free-form revision text to a chosen variant (re-runs AI).
 */
app.post('/approvals/:id/revise', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as
    | { variantId: string; revisionText: string }
    | null;
  if (!body?.variantId || !body.revisionText) return c.json({ error: 'variantId + revisionText required' }, 400);
  const a = await db.approval.findUnique({ where: { id } });
  if (!a || a.status !== 'pending') return c.json({ error: 'not pending' }, 404);
  const variants = a.variants as unknown as Array<{ variant_id: string }>;
  const cur = variants.find((v) => v.variant_id === body.variantId);
  if (!cur) return c.json({ error: 'variant not found' }, 404);
  try {
    const { reviseVariant } = await import('../services/ai/campaign-builder.js');
    const updated = await reviseVariant(cur as never, body.revisionText);
    const idx = variants.findIndex((v) => v.variant_id === body.variantId);
    if (idx >= 0) variants[idx] = { ...updated, variant_id: cur.variant_id } as never;
    await db.approval.update({
      where: { id },
      data: { variants: variants as unknown as object },
    });
    return c.json({ ok: true, variant: variants[idx] });
  } catch (err) {
    logger.error({ err }, 'revise from miniapp failed');
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

/* ───── POST /api/miniapp/approvals/:id/reject ───── */
app.post('/approvals/:id/reject', async (c) => {
  const id = c.req.param('id');
  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) return c.json({ error: 'Not found' }, 404);
  if (approval.status === 'applied') {
    return c.json({ error: 'Already applied to Direct, cannot reject' }, 409);
  }
  await db.approval.update({
    where: { id },
    data: { status: 'rejected', rejectedAt: new Date() },
  });
  return c.json({ ok: true });
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

/* ───── POST /api/miniapp/knowledge/document ───── */
app.post('/knowledge/document', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { name?: string; scope?: string; text?: string; tags?: string[] }
    | null;
  if (!body?.name || !body?.text) {
    return c.json({ error: 'name and text required' }, 400);
  }
  const scope = body.scope === 'network' ? 'network' : body.scope === 'search' ? 'search' : 'global';
  await db.knowledgeEntry.create({
    data: {
      type: 'document',
      scope,
      data: {
        name: body.name.slice(0, 200),
        text: body.text.slice(0, 50_000),
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : [],
      },
      generatedBy: 'manual-upload',
    },
  });
  return c.json({ ok: true });
});

/* ───── DELETE /api/miniapp/knowledge/:id ───── */
app.post('/knowledge/:id/delete', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'bad id' }, 400);
  await db.knowledgeEntry.update({ where: { id }, data: { isActive: false } });
  return c.json({ ok: true });
});

/* ───── POST /api/miniapp/knowledge/:id/edit ───── */
app.post('/knowledge/:id/edit', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'bad id' }, 400);
  const body = await c.req.json().catch(() => null) as
    | { name?: string; text?: string; rules?: string; scope?: string }
    | null;
  if (!body) return c.json({ error: 'body required' }, 400);

  const entry = await db.knowledgeEntry.findUnique({ where: { id } });
  if (!entry) return c.json({ error: 'not found' }, 404);

  const data = (entry.data as Record<string, unknown>) ?? {};
  if (body.name !== undefined) data.name = body.name.slice(0, 200);
  if (body.text !== undefined) data.text = body.text.slice(0, 50_000);
  if (body.rules !== undefined) data.rules = body.rules.slice(0, 50_000);

  await db.knowledgeEntry.update({
    where: { id },
    data: {
      data: data as object,
      ...(body.scope && ['search', 'network', 'global'].includes(body.scope)
        ? { scope: body.scope }
        : {}),
    },
  });
  return c.json({ ok: true });
});

/* ───── POST /api/miniapp/create-campaign ─────
 * Run the full campaign-builder flow from the Mini App.
 * Creates an Approval ready to be picked up either from the bot
 * (via existing buttons) or from the Mini App approvals list.
 */
app.post('/create-campaign', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | {
        kind?: 'search' | 'network';
        geo?: string;
        budget?: number;
        cpl?: number;
        url?: string;
        brief?: string;
        imageHash?: string | null;
      }
    | null;

  if (!body?.kind || !body.geo || !body.budget || !body.brief) {
    return c.json({ error: 'kind, geo, budget, brief required' }, 400);
  }

  try {
    const tgUserId = c.get('tgUserId');
    const builder = await import('../services/ai/campaign-builder.js');
    const { config } = await import('../lib/config.js');

    let cpl = body.cpl;
    if (!cpl) {
      const sug = await builder.suggestCpl({
        campaignType: body.kind,
        geo: body.geo,
        dailyBudget: body.budget,
        brief: body.brief,
      });
      cpl = sug.suggested_cpl;
    }

    let result;
    if (body.kind === 'search') {
      result = await builder.buildSearchCampaign({
        campaignType: 'search',
        geo: body.geo,
        dailyBudget: body.budget,
        targetCpl: cpl,
        siteUrl: body.url ?? config.BUSINESS_SITE,
        brief: body.brief,
      });
    } else {
      const img = body.imageHash
        ? await db.yandexImage.findUnique({ where: { hash: body.imageHash } })
        : null;
      result = await builder.buildNetworkCampaign({
        campaignType: 'network',
        geo: body.geo,
        dailyBudget: body.budget,
        targetCpl: cpl,
        siteUrl: body.url ?? config.BUSINESS_SITE,
        brief: body.brief,
        imageHash: body.imageHash ?? null,
        imageDescription: img?.description ?? null,
      });
    }

    const approval = await db.approval.create({
      data: {
        chatId: BigInt(tgUserId),
        status: 'pending',
        campaignType: body.kind,
        geo: result.resolvedGeoName,
        regionId: result.regionId,
        dailyBudget: body.budget,
        siteUrl: body.url ?? config.BUSINESS_SITE,
        targetCpl: cpl,
        cplSuggested: !body.cpl,
        variants: result.variants as unknown as object,
        ...(body.kind === 'network' && body.imageHash
          ? { selectedImageHashes: [body.imageHash] }
          : {}),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    return c.json({
      approvalId: approval.id,
      cpl,
      variants: result.variants,
    });
  } catch (err) {
    logger.error({ err }, 'create-campaign from miniapp failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/* ───── POST /api/miniapp/approvals/:id/apply ───── */
app.post('/approvals/:id/apply', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as { variantId?: string } | null;
  if (!body?.variantId) return c.json({ error: 'variantId required' }, 400);

  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval || approval.status !== 'pending') return c.json({ error: 'approval not pending' }, 404);

  const variants = approval.variants as unknown as Array<{ variant_id: string; draft: unknown }>;
  const variant = variants.find((v) => v.variant_id === body.variantId);
  if (!variant) return c.json({ error: 'variant not found' }, 404);

  try {
    const { applyVariant } = await import('../services/yandex-direct/apply-engine.js');
    const result = await applyVariant({
      variant: variant as never,
      campaignType: approval.campaignType as 'search' | 'network',
      regionId: approval.regionId,
      dailyBudget: approval.dailyBudget,
      imageHash: approval.selectedImageHashes[0] ?? undefined,
    });
    await db.approval.update({
      where: { id },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        selectedVariantId: body.variantId,
        yandexCampaignId: result.campaignId,
        yandexAdgroupId: result.adgroupId,
        yandexAdId: result.adId,
      },
    });
    return c.json({
      ok: true,
      campaignId: result.campaignId.toString(),
      adgroupId: result.adgroupId.toString(),
      adId: result.adId.toString(),
      campaignCreated: result.campaignCreated,
      adgroupCreated: result.adgroupCreated,
      keywordsAdded: result.keywordsAdded,
      imageAttached: result.imageAttached,
    });
  } catch (err) {
    logger.error({ err, id }, 'apply from miniapp failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
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

/* ───── POST /api/miniapp/upload-image ─────
 * Accepts a base64-encoded image (DataURL or raw base64). Auto-crops to
 * 1080×608 (TextImageAd WIDE) and uploads to Direct. Returns hash.
 */
app.post('/upload-image', async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { name?: string; dataUrl?: string }
    | null;
  if (!body?.dataUrl) return c.json({ error: 'dataUrl required' }, 400);

  // Accept "data:image/jpeg;base64,XXX" or raw base64
  let b64 = body.dataUrl;
  const commaIdx = b64.indexOf('base64,');
  if (commaIdx >= 0) b64 = b64.slice(commaIdx + 'base64,'.length);

  try {
    const raw = Buffer.from(b64, 'base64');
    const { prepareForDirect } = await import('../services/yandex-direct/image-prepare.js');
    const prepared = await prepareForDirect(raw);
    const { uploadAdImage } = await import('../services/yandex-direct/imageads.js');
    const hash = await uploadAdImage({
      imageBase64: prepared.buffer.toString('base64'),
      name: body.name ? body.name.slice(0, 50) : `miniapp-${Date.now()}`,
    });
    const tgUserId = c.get('tgUserId');
    await db.yandexImage.upsert({
      where: { hash },
      create: {
        hash,
        name: body.name ?? null,
        format: 'JPEG',
        uploadedBy: BigInt(tgUserId),
      },
      update: {},
    });
    return c.json({
      hash,
      width: prepared.width,
      height: prepared.height,
      target: prepared.target.name,
    });
  } catch (err) {
    logger.error({ err }, 'upload-image from miniapp failed');
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default app;
