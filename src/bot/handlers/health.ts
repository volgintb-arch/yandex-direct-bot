import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import * as wordstat from '../../services/wordstat/client.js';
import * as ygpt from '../../services/ai/yandex-gpt.js';
import * as crm from '../../services/crm-questlegends/client.js';
import { listCampaigns } from '../../services/yandex-direct/campaigns.js';

interface CheckResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

async function timed(name: string, fn: () => Promise<boolean | string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return {
      name,
      ok: typeof r === 'boolean' ? r : true,
      ms: Date.now() - start,
      detail: typeof r === 'string' ? r : undefined,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Date.now() - start,
      detail: err instanceof Error ? err.message.slice(0, 120) : String(err),
    };
  }
}

export async function handleHealth(ctx: SessionContext): Promise<void> {
  const status = await ctx.reply('⏳ Проверяю все API...');

  const checks = await Promise.all([
    timed('Database', async () => {
      await db.$queryRaw`SELECT 1`;
      return true;
    }),
    timed('Yandex Direct', async () => {
      const list = await listCampaigns();
      return `${list.length} кампаний`;
    }),
    timed('Wordstat', () => wordstat.ping()),
    timed('YandexGPT Lite', () => ygpt.ping('lite')),
    timed('YandexGPT Pro', () => ygpt.ping('pro')),
    timed('CRM (QuestLegends)', () => crm.ping()),
  ]);

  const lines = ['*🩺 Health Check*', ''];
  for (const c of checks) {
    const icon = c.ok ? '✅' : '❌';
    const detail = c.detail ? ` — ${c.detail}` : '';
    lines.push(`${icon} *${c.name}* (${c.ms}ms)${detail}`);
  }

  const allOk = checks.every((c) => c.ok);
  lines.push('');
  lines.push(allOk ? '*Всё работает.*' : '*⚠️ Есть проблемы.*');

  logger.info({ checks }, 'health check done');

  await ctx.api.editMessageText(ctx.chat!.id, status.message_id, lines.join('\n'), {
    parse_mode: 'Markdown',
  });
}
