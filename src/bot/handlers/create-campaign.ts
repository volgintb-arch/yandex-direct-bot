import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import {
  parseCreateCampaignCommand,
  missingFields,
  type ParsedCreateCampaign,
} from '../command-parser.js';
import { cplChoiceKeyboard, variantsKeyboard } from '../keyboards.js';
import { formatVariantShort } from '../format.js';
import { buildSearchCampaign, suggestCpl } from '../../services/ai/campaign-builder.js';
import type { CampaignVariant } from '../../services/ai/prompts/search-campaign.js';

/**
 * Entry point for "создай поиск/рся ..." commands.
 * Decides whether to start asking for missing fields or run generation immediately.
 */
export async function handleCreateCampaign(ctx: SessionContext): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const parsed = parseCreateCampaignCommand(text);
  if (!parsed) {
    await ctx.reply('Не понял. Пример: `создай поиск гео:Краснодар бюджет:1500`', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Phase 3 = search only. РСЯ comes in Phase 4.
  if (parsed.kind === 'network') {
    await ctx.reply('🚧 РСЯ-кампании — следующая фаза. Пока умею только Поиск.');
    return;
  }

  const missing = missingFields(parsed);
  if (missing.length > 0) {
    await askForMissing(ctx, parsed, missing);
    return;
  }

  // Everything provided → CPL flow
  await startCplFlow(ctx, parsed as Required<Pick<ParsedCreateCampaign, 'geo' | 'budget' | 'brief'>> & ParsedCreateCampaign);
}

async function askForMissing(
  ctx: SessionContext,
  parsed: ParsedCreateCampaign,
  missing: Array<'geo' | 'budget' | 'brief'>
): Promise<void> {
  const labels: Record<typeof missing[number], string> = {
    geo: 'город (например: `гео:Краснодар`)',
    budget: 'дневной бюджет (например: `бюджет:1500`)',
    brief: 'бриф — что рекламируем, в честь чего, что подчеркнуть (несколько предложений)',
  };

  const lines = [
    '⚠️ Не хватает данных:',
    '',
    ...missing.map((f) => `• ${labels[f]}`),
    '',
    '*Пример полной команды:*',
    '```',
    'создай поиск гео:Краснодар бюджет:1500',
    'Реклама квестов на день рождения для детей 10-14 лет.',
    'Подчеркнуть атмосферу приключения, новые сюжеты на тему пиратов.',
    'Скидка 15% на первое бронирование.',
    '```',
  ];
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

/** CPL choice — let AI suggest or enter manually. */
async function startCplFlow(
  ctx: SessionContext,
  parsed: ParsedCreateCampaign & { geo: string; budget: number; brief: string }
): Promise<void> {
  // If CPL already in command — skip the flow.
  if (parsed.cpl && parsed.cpl > 0) {
    await runGeneration(ctx, parsed, parsed.cpl);
    return;
  }

  // Persist parsed params on the session so callback handlers can pick them up.
  ctx.session.context = {
    ...ctx.session.context,
    pendingCommand: {
      kind: parsed.kind,
      geo: parsed.geo,
      budget: parsed.budget,
      brief: parsed.brief,
      url: parsed.url ?? config.BUSINESS_SITE,
    },
  };
  await ctx.saveSession();

  await ctx.reply(
    `*Целевой CPL для кампании "${parsed.geo}" не указан.*\nКак определить?`,
    { parse_mode: 'Markdown', reply_markup: cplChoiceKeyboard('pending') }
  );
}

/** Called from callback after CPL is decided. */
export async function runGeneration(
  ctx: SessionContext,
  parsed: ParsedCreateCampaign & { geo: string; budget: number; brief: string },
  cpl: number
): Promise<void> {
  const status = await ctx.reply('⏳ Анализирую город и подбираю ключевики через Wordstat...');

  try {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '⏳ Генерирую 3 варианта через YandexGPT Pro...'
    );

    const result = await buildSearchCampaign({
      campaignType: 'search',
      geo: parsed.geo,
      dailyBudget: parsed.budget,
      targetCpl: cpl,
      siteUrl: parsed.url ?? config.BUSINESS_SITE,
      brief: parsed.brief,
    });

    // Persist as Approval (24h TTL).
    const approval = await db.approval.create({
      data: {
        chatId: BigInt(ctx.chat!.id),
        status: 'pending',
        campaignType: 'search',
        geo: result.resolvedGeoName,
        regionId: result.regionId,
        dailyBudget: parsed.budget,
        siteUrl: parsed.url ?? config.BUSINESS_SITE,
        targetCpl: cpl,
        cplSuggested: false,
        variants: result.variants as unknown as object,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    // Reset session context — generation done.
    ctx.session.context = {};
    ctx.session.state = 'idle';
    ctx.session.pendingApprovalId = approval.id;
    await ctx.saveSession();

    // Edit progress message → summary.
    const summary = [
      `✅ Готово! 3 варианта поисковой кампании:`,
      `📍 ${result.resolvedGeoName} · 💰 ${parsed.budget} ₽/день · 🎯 CPL ${cpl} ₽`,
      `🔍 Wordstat: ${result.wordstatPhrasesUsed} фраз использовано`,
      '',
      ...result.variants.map((v, i) => `*${i + 1}.* ${formatVariantShort(v)}`),
      '',
      'Выбери вариант для подробного просмотра:',
    ].join('\n\n');

    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, summary, {
      parse_mode: 'Markdown',
      reply_markup: variantsKeyboard(approval.id, result.variants as CampaignVariant[]),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'campaign generation failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не получилось сгенерировать: ${msg}`
    );
  }
}
