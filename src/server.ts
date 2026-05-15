import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { webhookCallback } from 'grammy';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { db, disconnectDb } from './lib/db.js';
import { bot, bootstrapBot, startBotPolling, stopBot } from './bot/index.js';
import marketingApi from './miniapp-api/marketing.js';
import miniappApi from './miniapp-api/miniapp.js';
import { startScheduler } from './jobs/scheduler.js';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

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

// Marketing aggregates API for QuestLegends OS to consume
// (cost / impressions / clicks per campaign and ad).
app.route('/api/marketing', marketingApi);

// Mini App API (Telegram WebApp). Auth via X-Telegram-Init-Data header.
app.route('/api/miniapp', miniappApi);

// Serve the Mini App static bundle from miniapp/dist if it was built.
const miniappDist = pathResolve(process.cwd(), 'miniapp/dist');
if (existsSync(miniappDist)) {
  app.use('/assets/*', serveStatic({ root: './miniapp/dist' }));
  app.use('/favicon.ico', serveStatic({ root: './miniapp/dist' }));
  // SPA fallback — every non-API path serves index.html so the React router takes over.
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    return serveStatic({ path: './miniapp/dist/index.html' })(c, next);
  });
  logger.info({ dir: miniappDist }, '🪟 mini-app static mounted at /');
}

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

// Periodic background jobs (sync-leads /4h, daily-learning at 06:00 MSK).
startScheduler();

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
