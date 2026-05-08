import cron from 'node-cron';
import { logger } from '../lib/logger.js';
import { syncLeads } from './sync-leads.js';
import { runDailyLearning } from './daily-learning.js';

/** Wire the periodic background jobs. Idempotent — safe to call once at boot. */
export function startScheduler(): void {
  // Every 4 hours at :05 — pull fresh CRM leads + Direct cost.
  cron.schedule('5 */4 * * *', async () => {
    try {
      const r = await syncLeads();
      logger.info({ result: r }, 'cron sync-leads ok');
    } catch (err) {
      logger.error({ err }, 'cron sync-leads failed');
    }
  });

  // Every day at 06:00 MSK — refresh learned rules from the last 30 days.
  cron.schedule(
    '0 6 * * *',
    async () => {
      try {
        const r = await runDailyLearning();
        logger.info(
          { search: r.search?.topCount, network: r.network?.topCount },
          'cron daily-learning ok'
        );
      } catch (err) {
        logger.error({ err }, 'cron daily-learning failed');
      }
    },
    { timezone: 'Europe/Moscow' }
  );

  logger.info('🕒 scheduler started: sync-leads /4h, daily-learning at 06:00 MSK');
}
