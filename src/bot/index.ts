import { Bot, type Context } from 'grammy';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { authMiddleware, ensureBootstrapAdmin, requireAdmin, type AuthorizedContext } from './middlewares/auth.js';
import { sessionMiddleware, type SessionContext } from './middlewares/session.js';
import { handleStart, handleHelp } from './handlers/start.js';
import { handleHealth } from './handlers/health.js';
import { handleGrant, handleRevoke, handleUsers } from './handlers/grant.js';

export const bot = new Bot<SessionContext>(config.TELEGRAM_BOT_TOKEN);

// Middlewares (order matters)
bot.use(async (ctx, next) => authMiddleware(ctx as Context, next));
bot.use(async (ctx, next) => sessionMiddleware(ctx as AuthorizedContext, next));

// Public handlers
bot.command('start', handleStart);
bot.command('help', handleHelp);
bot.command('ping', async (ctx) => {
  await ctx.reply('pong');
});
bot.command('health', handleHealth);

// Admin handlers
bot.command('grant', async (ctx, next) => requireAdmin(ctx, () => Promise.resolve(handleGrant(ctx))));
bot.command('revoke', async (ctx, next) => requireAdmin(ctx, () => Promise.resolve(handleRevoke(ctx))));
bot.command('users', async (ctx, next) => requireAdmin(ctx, () => Promise.resolve(handleUsers(ctx))));

// Set bot command list (visible in / menu)
export async function setBotCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начало работы' },
    { command: 'help', description: 'Справка' },
    { command: 'health', description: 'Проверить все API' },
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
