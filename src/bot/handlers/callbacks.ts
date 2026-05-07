import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import { variantActionsKeyboard, variantsKeyboard, cplSuggestionKeyboard } from '../keyboards.js';
import { formatVariantCard } from '../format.js';
import { applyVariant } from '../../services/yandex-direct/apply-engine.js';
import { suggestCpl, shrinkVariant, reviseVariant } from '../../services/ai/campaign-builder.js';
import { runGeneration } from './create-campaign.js';
import type { CampaignVariant } from '../../services/ai/prompts/search-campaign.js';
import { variantHasIssues } from '../../services/ai/validate.js';

interface PendingCommand {
  kind: 'search' | 'network';
  geo: string;
  budget: number;
  brief: string;
  url: string;
}

/** Find variant by id within an approval. */
function findVariant(approval: { variants: unknown }, variantId: string): CampaignVariant | null {
  const variants = approval.variants as CampaignVariant[];
  return variants.find((v) => v.variant_id === variantId) ?? null;
}

/** Get pending command from session, validated. */
function getPendingCommand(ctx: SessionContext): PendingCommand | null {
  const pc = ctx.session.context.pendingCommand as Partial<PendingCommand> | undefined;
  if (!pc?.geo || !pc.budget || !pc.brief || !pc.kind) return null;
  return {
    kind: pc.kind,
    geo: pc.geo,
    budget: pc.budget,
    brief: pc.brief,
    url: pc.url ?? config.BUSINESS_SITE,
  };
}

/* ─── CPL flow ─────────────────────────────────────────────────────── */

export async function handleCplAi(ctx: SessionContext): Promise<void> {
  const cmd = getPendingCommand(ctx);
  if (!cmd) {
    await ctx.answerCallbackQuery({ text: 'Сессия истекла, начни заново' });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'ИИ анализирует...' });
  await ctx.editMessageText('⏳ ИИ анализирует рынок и историю...');

  try {
    const sug = await suggestCpl({
      campaignType: cmd.kind,
      geo: cmd.geo,
      dailyBudget: cmd.budget,
      brief: cmd.brief,
    });

    ctx.session.context = {
      ...ctx.session.context,
      pendingCommand: cmd,
      suggestedCpl: sug.suggested_cpl,
    };
    await ctx.saveSession();

    await ctx.editMessageText(
      `💡 *ИИ предлагает CPL: ${sug.suggested_cpl} ₽*\n\n_${sug.reasoning}_`,
      { parse_mode: 'Markdown', reply_markup: cplSuggestionKeyboard('pending') }
    );
  } catch (err) {
    logger.error({ err }, 'CPL suggestion failed');
    await ctx.editMessageText('❌ Не удалось предложить CPL. Введи вручную числом.');
    ctx.session.state = 'awaiting_cpl';
    await ctx.saveSession();
  }
}

export async function handleCplAccept(ctx: SessionContext): Promise<void> {
  const cmd = getPendingCommand(ctx);
  const cpl = ctx.session.context.suggestedCpl as number | undefined;
  if (!cmd || !cpl) {
    await ctx.answerCallbackQuery({ text: 'Сессия истекла, начни заново' });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'CPL принят' });
  await ctx.deleteMessage().catch(() => {});
  await runGeneration(ctx, cmd, cpl);
}

export async function handleCplManual(ctx: SessionContext): Promise<void> {
  const cmd = getPendingCommand(ctx);
  if (!cmd) {
    await ctx.answerCallbackQuery({ text: 'Сессия истекла, начни заново' });
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.state = 'awaiting_cpl';
  await ctx.saveSession();
  await ctx.editMessageText('✍️ Введи целевой CPL числом (например: `800`)', {
    parse_mode: 'Markdown',
  });
}

/** Text handler for state=awaiting_cpl. */
export async function handleCplText(ctx: SessionContext, text: string): Promise<void> {
  const cpl = parseInt(text.replace(/[^\d]/g, ''), 10);
  if (isNaN(cpl) || cpl < 50 || cpl > 50000) {
    await ctx.reply('Введи число от 50 до 50000 (рублей)');
    return;
  }
  const cmd = getPendingCommand(ctx);
  if (!cmd) {
    ctx.session.state = 'idle';
    await ctx.saveSession();
    await ctx.reply('Сессия истекла, начни команду заново');
    return;
  }
  ctx.session.state = 'idle';
  await ctx.saveSession();
  await runGeneration(ctx, cmd, cpl);
}

/* ─── Variant flow ─────────────────────────────────────────────────── */

export async function handleSelectVariant(
  ctx: SessionContext,
  approvalId: string,
  variantId: string
): Promise<void> {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Черновик не найден или уже обработан' });
    return;
  }
  const variant = findVariant(approval, variantId);
  if (!variant) {
    await ctx.answerCallbackQuery({ text: 'Вариант не найден' });
    return;
  }

  await db.approval.update({
    where: { id: approvalId },
    data: { selectedVariantId: variantId },
  });
  await ctx.answerCallbackQuery({ text: `Выбран: ${variant.title}` });

  const hasIssues = variantHasIssues(variant);
  await ctx.editMessageText(formatVariantCard(variant), {
    parse_mode: 'Markdown',
    reply_markup: variantActionsKeyboard(approvalId, hasIssues),
    link_preview_options: { is_disabled: true },
  });
}

/** Auto-shrink fields that exceed Direct char limits. */
export async function handleShrink(ctx: SessionContext, approvalId: string): Promise<void> {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'pending' || !approval.selectedVariantId) {
    await ctx.answerCallbackQuery({ text: 'Сначала выбери вариант' });
    return;
  }
  const current = findVariant(approval, approval.selectedVariantId);
  if (!current) {
    await ctx.answerCallbackQuery({ text: 'Вариант не найден' });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Сокращаю...' });
  await ctx.editMessageText('✂️ Сокращаю поля до лимитов Директа...');

  try {
    const updated = await shrinkVariant(current);
    const variants = approval.variants as unknown as CampaignVariant[];
    const idx = variants.findIndex((v) => v.variant_id === approval.selectedVariantId);
    if (idx >= 0) variants[idx] = updated;
    await db.approval.update({
      where: { id: approvalId },
      data: { variants: variants as unknown as object },
    });
    const hasIssues = variantHasIssues(updated);
    await ctx.editMessageText(formatVariantCard(updated), {
      parse_mode: 'Markdown',
      reply_markup: variantActionsKeyboard(approvalId, hasIssues),
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, approvalId }, 'shrink failed');
    await ctx.editMessageText(`❌ Не удалось сократить: ${msg}`, {
      reply_markup: variantActionsKeyboard(approvalId, true),
    });
  }
}

export async function handleBack(ctx: SessionContext, approvalId: string): Promise<void> {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Черновик не найден' });
    return;
  }
  await ctx.answerCallbackQuery();
  const variants = approval.variants as unknown as CampaignVariant[];
  const summary = [
    `📍 ${approval.geo} · 💰 ${approval.dailyBudget} ₽/день · 🎯 CPL ${approval.targetCpl} ₽`,
    '',
    ...variants.map((v, i) => `*${i + 1}.* _${v.title}_ — ${v.draft.adgroup_name}`),
    '',
    'Выбери вариант:',
  ].join('\n');
  await ctx.editMessageText(summary, {
    parse_mode: 'Markdown',
    reply_markup: variantsKeyboard(approvalId, variants),
  });
}

export async function handleRevise(ctx: SessionContext, approvalId: string): Promise<void> {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'pending' || !approval.selectedVariantId) {
    await ctx.answerCallbackQuery({ text: 'Сначала выбери вариант' });
    return;
  }
  ctx.session.state = 'awaiting_revision_text';
  ctx.session.pendingApprovalId = approvalId;
  await ctx.saveSession();
  await ctx.answerCallbackQuery();
  await ctx.reply('✏️ Опиши что изменить (например: «убери упоминание скидки», «добавь акцент на семейный отдых»)');
}

export async function handleReject(ctx: SessionContext, approvalId: string): Promise<void> {
  await db.approval.update({
    where: { id: approvalId },
    data: { status: 'rejected', rejectedAt: new Date() },
  });
  ctx.session.pendingApprovalId = null;
  ctx.session.state = 'idle';
  await ctx.saveSession();
  await ctx.answerCallbackQuery({ text: 'Отклонено' });
  await ctx.editMessageText('🗑 Черновик отклонён.');
}

export async function handleApply(ctx: SessionContext, approvalId: string): Promise<void> {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'pending' || !approval.selectedVariantId) {
    await ctx.answerCallbackQuery({ text: 'Сначала выбери вариант' });
    return;
  }
  const variant = findVariant(approval, approval.selectedVariantId);
  if (!variant) {
    await ctx.answerCallbackQuery({ text: 'Вариант не найден' });
    return;
  }

  // Guard: refuse to apply if any field still exceeds Direct limits.
  if (variantHasIssues(variant)) {
    await ctx.answerCallbackQuery({ text: 'Сначала сократи поля' });
    await ctx.editMessageText(formatVariantCard(variant), {
      parse_mode: 'Markdown',
      reply_markup: variantActionsKeyboard(approvalId, true),
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Применяю...' });
  await ctx.editMessageText('⏳ Применяю в Яндекс.Директ...');

  try {
    const result = await applyVariant({
      variant,
      campaignType: approval.campaignType as 'search' | 'network',
      regionId: approval.regionId,
      dailyBudget: approval.dailyBudget,
    });

    await db.approval.update({
      where: { id: approvalId },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        yandexCampaignId: result.campaignId,
        yandexAdgroupId: result.adgroupId,
        yandexAdId: result.adId,
      },
    });
    await db.ad.update({ where: { yandexId: result.adId }, data: { approvalId } }).catch(() => {});

    ctx.session.pendingApprovalId = null;
    ctx.session.state = 'idle';
    await ctx.saveSession();

    const lines = [
      '✅ *Готово, отправлено в Яндекс.Директ!*',
      '',
      `📁 Кампания: ${result.campaignCreated ? '🆕 создана' : '♻️ существующая'}`,
      `   ID \`${result.campaignId}\``,
      `📂 Группа: ${result.adgroupCreated ? '🆕 создана' : '♻️ существующая'}`,
      `   ID \`${result.adgroupId}\``,
      result.keywordsAdded ? `🔑 Ключевиков добавлено: ${result.keywordsAdded}` : '',
      `📝 Объявление ID \`${result.adId}\` — отправлено на модерацию`,
    ]
      .filter(Boolean)
      .join('\n');
    await ctx.editMessageText(lines, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error({ err, approvalId }, 'apply failed');
    const msg = formatErrorForUser(err);
    await ctx.editMessageText(`❌ Ошибка применения:\n${msg}`, {
      reply_markup: variantActionsKeyboard(approvalId),
    });
  }
}

function formatErrorForUser(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message?: string; detail?: string; code?: number | string };
    const parts = [e.message ?? 'Unknown error'];
    if (e.detail) parts.push(`📋 ${e.detail}`);
    if (e.code !== undefined) parts.push(`(код ${e.code})`);
    return parts.join('\n');
  }
  return String(err);
}

/* ─── Revision text handler (state=awaiting_revision_text) ────────── */

export async function handleRevisionText(ctx: SessionContext, text: string): Promise<void> {
  const approvalId = ctx.session.pendingApprovalId;
  if (!approvalId) {
    ctx.session.state = 'idle';
    await ctx.saveSession();
    await ctx.reply('Сессия истекла. Начни заново.');
    return;
  }
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== 'pending' || !approval.selectedVariantId) {
    ctx.session.state = 'idle';
    ctx.session.pendingApprovalId = null;
    await ctx.saveSession();
    await ctx.reply('Черновик не найден. Начни заново.');
    return;
  }
  const current = findVariant(approval, approval.selectedVariantId);
  if (!current) {
    await ctx.reply('Вариант пропал. Начни заново.');
    return;
  }

  const status = await ctx.reply('⏳ Применяю правки...');
  try {
    const updated = await reviseVariant(current, text);

    // Replace variant in array
    const variants = approval.variants as unknown as CampaignVariant[];
    const idx = variants.findIndex((v) => v.variant_id === approval.selectedVariantId);
    if (idx >= 0) variants[idx] = { ...updated, variant_id: current.variant_id };

    await db.approval.update({
      where: { id: approvalId },
      data: { variants: variants as unknown as object },
    });

    ctx.session.state = 'idle';
    await ctx.saveSession();

    const hasIssues = variantHasIssues(updated);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      formatVariantCard(updated),
      {
        parse_mode: 'Markdown',
        reply_markup: variantActionsKeyboard(approvalId, hasIssues),
        link_preview_options: { is_disabled: true },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'revision failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не удалось применить правки: ${msg}\n\nПопробуй ещё раз или нажми /cancel`
    );
  }
}
