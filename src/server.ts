import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { webhookCallback } from 'grammy';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { db, disconnectDb } from './lib/db.js';
import { bot, bootstrapBot, startBotPolling, stopBot } from './bot/index.js';

const app = new Hono();

app.get('/', (c) =>
  c.json({
    ok: true,
    service: 'yandex-direct-bot',
    version: '0.1.0',
    env: config.NODE_ENV,
  })
);

app.get('/health', async (c) => {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    logger.warn({ err }, 'db healthcheck failed');
  }

  return c.json({
    ok: dbOk,
    service: 'yandex-direct-bot',
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
});

// Telegram webhook (used in production when TELEGRAM_USE_POLLING=false)
if (!config.TELEGRAM_USE_POLLING) {
  const tgHandler = webhookCallback(bot, 'hono', {
    secretToken: config.TELEGRAM_WEBHOOK_SECRET,
  });
  app.post('/api/telegram/webhook', tgHandler);
  logger.info('telegram webhook mounted at /api/telegram/webhook');
}

const server = serve(
  { fetch: app.fetch, port: config.PORT },
  (info) => {
    logger.info(
      { port: info.port, env: config.NODE_ENV, polling: config.TELEGRAM_USE_POLLING },
      '🚀 server started'
    );
  }
);

// Bootstrap (admin whitelist + commands list) runs in BOTH modes.
bootstrapBot().catch((err) => {
  logger.fatal({ err }, 'failed to bootstrap bot');
  process.exit(1);
});

if (config.TELEGRAM_USE_POLLING) {
  startBotPolling().catch((err) => {
    logger.fatal({ err }, 'failed to start bot polling');
    process.exit(1);
  });
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  if (config.TELEGRAM_USE_POLLING) await stopBot().catch(() => {});
  server.close();
  await disconnectDb().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
