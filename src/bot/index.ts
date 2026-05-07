import { Bot, type Context } from 'grammy';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import {
  authMiddleware,
  ensureBootstrapAdmin,
  requireAdmin,
  type AuthorizedContext,
} from './middlewares/auth.js';
import { sessionMiddleware, type SessionContext } from './middlewares/session.js';
import { handleStart, handleHelp } from './handlers/start.js';
import { handleHealth } from './handlers/health.js';
import { handleGrant, handleRevoke, handleUsers } from './handlers/grant.js';
import { handleCreateCampaign } from './handlers/create-campaign.js';
import {
  handleCplAi,
  handleCplAccept,
  handleCplManual,
  handleCplText,
  handleSelectVariant,
  handleBack,
  handleRevise,
  handleReject,
  handleApply,
  handleRevisionText,
} from './handlers/callbacks.js';

export const bot = new Bot<SessionContext>(config.TELEGRAM_BOT_TOKEN);

// ─── Middlewares ──────────────────────────────────────────────────────
bot.use(async (ctx, next) => authMiddleware(ctx as Context, next));
bot.use(async (ctx, next) => sessionMiddleware(ctx as AuthorizedContext, next));

// ─── Commands ─────────────────────────────────────────────────────────
bot.command('start', handleStart);
bot.command('help', handleHelp);
bot.command('ping', async (ctx) => {
  await ctx.reply('pong');
});
bot.command('health', handleHealth);
bot.command('cancel', async (ctx) => {
  ctx.session.state = 'idle';
  ctx.session.pendingApprovalId = null;
  ctx.session.context = {};
  await ctx.saveSession();
  await ctx.reply('🛑 Текущее действие отменено.');
});

// Admin
bot.command('grant', async (ctx) => requireAdmin(ctx, () => Promise.resolve(handleGrant(ctx))));
bot.command('revoke', async (ctx) => requireAdmin(ctx, () => Promise.resolve(handleRevoke(ctx))));
bot.command('users', async (ctx) => requireAdmin(ctx, () => Promise.resolve(handleUsers(ctx))));

// ─── Callback queries ─────────────────────────────────────────────────
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, arg1, arg2] = data.split('|');
  try {
    switch (action) {
      case 'cpl_ai':
        await handleCplAi(ctx);
        break;
      case 'cpl_accept':
        await handleCplAccept(ctx);
        break;
      case 'cpl_manual':
        await handleCplManual(ctx);
        break;
      case 'select':
        if (arg1 && arg2) await handleSelectVariant(ctx, arg1, arg2);
        break;
      case 'back':
        if (arg1) await handleBack(ctx, arg1);
        break;
      case 'revise':
        if (arg1) await handleRevise(ctx, arg1);
        break;
      case 'apply':
        if (arg1) await handleApply(ctx, arg1);
        break;
      case 'reject':
        if (arg1) await handleReject(ctx, arg1);
        break;
      default:
        await ctx.answerCallbackQuery({ text: 'Неизвестное действие' });
    }
  } catch (err) {
    logger.error({ err, action }, 'callback handler failed');
    await ctx.answerCallbackQuery({ text: '❌ Ошибка, попробуй ещё раз' }).catch(() => {});
  }
});

// ─── Free-form text messages ──────────────────────────────────────────
// Order matters: state-machine handlers > intent detection > unknown.
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // commands handled above

  // 1. State-machine: awaiting CPL number?
  if (ctx.session.state === 'awaiting_cpl') {
    await handleCplText(ctx, text);
    return;
  }
  // 2. State-machine: awaiting revision text?
  if (ctx.session.state === 'awaiting_revision_text') {
    await handleRevisionText(ctx, text);
    return;
  }

  // 3. Intent: "создай поиск/рся ..."
  if (/(?:создай|создать|create|сделай)\s+(поиск|search|рся|rsya|network|сеть)/i.test(text)) {
    await handleCreateCampaign(ctx);
    return;
  }

  // 4. Unknown
  await ctx.reply(
    'Не понял. Команды:\n`/help` — справка\n`/health` — статус API\n\nИли: `создай поиск гео:Краснодар бюджет:1500` (с брифом ниже)',
    { parse_mode: 'Markdown' }
  );
});

// ─── Bot meta ─────────────────────────────────────────────────────────
export async function setBotCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начало работы' },
    { command: 'help', description: 'Справка' },
    { command: 'health', description: 'Проверить все API' },
    { command: 'cancel', description: 'Отменить текущее действие' },
  ]);
}

bot.catch((err) => {
  logger.error({ err: err.error, update: err.ctx?.update }, 'bot error');
});

export async function startBotPolling(): Promise<void> {
  await ensureBootstrapAdmin();
  await setBotCommands().catch((err) => logger.warn({ err }, 'failed to set commands'));
  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => logger.info({ username: info.username }, '🤖 bot polling started'),
  });
}

export async function stopBot(): Promise<void> {
  await bot.stop();
}
