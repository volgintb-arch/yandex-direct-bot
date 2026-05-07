import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import {
  parseCreateCampaignCommand,
  missingFields,
  type ParsedCreateCampaign,
} from '../command-parser.js';
import { cplChoiceKeyboard, variantsKeyboard, imageRequestKeyboard } from '../keyboards.js';
import { formatVariantShort, escapeMd } from '../format.js';
import {
  buildSearchCampaign,
  buildNetworkCampaign,
  suggestCpl,
  type NetworkVariantWithImage,
} from '../../services/ai/campaign-builder.js';
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

  const missing = missingFields(parsed);
  if (missing.length > 0) {
    await askForMissing(ctx, parsed, missing);
    return;
  }

  // For РСЯ — ask for image FIRST (one image per request, applied to all 3 variants).
  // Only THEN go into CPL flow.
  if (parsed.kind === 'network') {
    await startImageFlow(ctx, parsed as Required<Pick<ParsedCreateCampaign, 'geo' | 'budget' | 'brief'>> & ParsedCreateCampaign);
    return;
  }

  // Search → straight to CPL
  await startCplFlow(ctx, parsed as Required<Pick<ParsedCreateCampaign, 'geo' | 'budget' | 'brief'>> & ParsedCreateCampaign);
}

/** Persist parsed command on session and ask user how to source the image. */
async function startImageFlow(
  ctx: SessionContext,
  parsed: ParsedCreateCampaign & { geo: string; budget: number; brief: string }
): Promise<void> {
  const { db } = await import('../../lib/db.js');
  const bankSize = await db.yandexImage.count();

  ctx.session.context = {
    ...ctx.session.context,
    pendingCommand: {
      kind: parsed.kind,
      geo: parsed.geo,
      budget: parsed.budget,
      brief: parsed.brief,
      url: parsed.url ?? config.BUSINESS_SITE,
      cpl: parsed.cpl ?? null,
    },
  };
  await ctx.saveSession();

  const lines = [
    '*🖼 Какой визуал использовать для РСЯ?*',
    '_Одна картинка будет применена ко всем 3 вариантам объявлений._',
    '',
    bankSize > 0
      ? `В банке: ${bankSize} картинок.`
      : '_Банк пуст. Можешь загрузить новую или создать без картинки._',
  ];
  await ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: imageRequestKeyboard(bankSize),
  });
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

/** Called from callback after CPL is decided. Dispatches by kind. */
export async function runGeneration(
  ctx: SessionContext,
  parsed: ParsedCreateCampaign & { geo: string; budget: number; brief: string },
  cpl: number
): Promise<void> {
  if (parsed.kind === 'network') {
    await runNetworkGeneration(ctx, parsed, cpl);
    return;
  }
  await runSearchGeneration(ctx, parsed, cpl);
}

async function runSearchGeneration(
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
    ctx.session.context = {};
    ctx.session.state = 'idle';
    ctx.session.pendingApprovalId = approval.id;
    await ctx.saveSession();

    const summary = [
      `✅ Готово! 3 варианта *поисковой* кампании:`,
      `📍 ${result.resolvedGeoName} · 💰 ${parsed.budget} ₽/день · 🎯 CPL ${cpl} ₽`,
      `🔍 Wordstat: ${result.wordstatPhrasesUsed} фраз`,
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
    logger.error({ err }, 'search generation failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не получилось сгенерировать: ${msg}`
    );
  }
}

async function runNetworkGeneration(
  ctx: SessionContext,
  parsed: ParsedCreateCampaign & { geo: string; budget: number; brief: string },
  cpl: number
): Promise<void> {
  const imageHash = (ctx.session.context.imageHash as string | null | undefined) ?? null;
  const imageDescription =
    (ctx.session.context.imageDescription as string | null | undefined) ?? null;

  const status = await ctx.reply(
    imageHash
      ? '⏳ Готовлю РСЯ с твоей картинкой...'
      : '⏳ Готовлю РСЯ (без картинки)...'
  );
  try {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      '⏳ Генерирую 3 варианта РСЯ через YandexGPT Pro...'
    );

    const result = await buildNetworkCampaign({
      campaignType: 'network',
      geo: parsed.geo,
      dailyBudget: parsed.budget,
      targetCpl: cpl,
      siteUrl: parsed.url ?? config.BUSINESS_SITE,
      brief: parsed.brief,
      imageHash,
      imageDescription,
    });

    const approval = await db.approval.create({
      data: {
        chatId: BigInt(ctx.chat!.id),
        status: 'pending',
        campaignType: 'network',
        geo: result.resolvedGeoName,
        regionId: result.regionId,
        dailyBudget: parsed.budget,
        siteUrl: parsed.url ?? config.BUSINESS_SITE,
        targetCpl: cpl,
        cplSuggested: false,
        variants: result.variants as unknown as object,
        selectedImageHashes: result.variants
          .map((v) => v.selectedImageHash)
          .filter((h): h is string => h !== null),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    ctx.session.context = {};
    ctx.session.state = 'idle';
    ctx.session.pendingApprovalId = approval.id;
    await ctx.saveSession();

    const summary = [
      `✅ Готово! ${result.variants.length} вариант(ов) *РСЯ*:`,
      `📍 ${result.resolvedGeoName} · 💰 ${parsed.budget} ₽/день · 🎯 CPL ${cpl} ₽`,
      `🖼 В банке: ${result.imagesAvailable} картинок`,
      '',
      ...result.variants.map((v, i) => {
        const imgLabel = v.selectedImageDescription
          ? v.selectedImageDescription.slice(0, 60)
          : v.selectedImageHash
            ? `файл #${v.selectedImageHash.slice(0, 8)}`
            : '';
        const imgInfo = v.selectedImageHash
          ? `\n🖼 ${escapeMd(imgLabel)}`
          : '\n⚠️ без картинки';
        return `*${i + 1}.* ${formatVariantShort(v as unknown as CampaignVariant)}${imgInfo}`;
      }),
      '',
      result.imagesAvailable === 0
        ? '_💡 Подсказка: отправь картинки в чат, чтобы пополнить банк РСЯ._'
        : 'Выбери вариант:',
    ].join('\n\n');

    await ctx.api.editMessageText(ctx.chat!.id, status.message_id, summary, {
      parse_mode: 'Markdown',
      reply_markup: variantsKeyboard(approval.id, result.variants as unknown as CampaignVariant[]),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'network generation failed');
    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      `❌ Не получилось сгенерировать РСЯ: ${msg}`
    );
  }
}
