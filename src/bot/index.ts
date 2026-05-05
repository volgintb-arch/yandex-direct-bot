import { Bot } from 'grammy';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Skeleton handler — replaced with full router in Phase 3.
bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  await ctx.reply(
    `👋 Yandex Direct Bot — скелет работает.\n\nВаш TG ID: ${userId}\n\nФункционал в разработке.`
  );
});

bot.command('ping', async (ctx) => {
  await ctx.reply('pong');
});

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, 'bot error');
});

export async function startBotPolling() {
  // Drop pending updates from when bot was offline.
  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => logger.info({ username: info.username }, '🤖 bot polling started'),
  });
}

export async function stopBot() {
  await bot.stop();
}
