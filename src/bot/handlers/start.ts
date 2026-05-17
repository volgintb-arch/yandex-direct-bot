import { InlineKeyboard } from 'grammy';
import type { SessionContext } from '../middlewares/session.js';
import { config } from '../../lib/config.js';

function appUrl(): string {
  return config.TELEGRAM_WEBHOOK_URL?.replace('/api/telegram/webhook', '') ?? 'https://direct-bot.questlegends.ru';
}

export async function handleStart(ctx: SessionContext): Promise<void> {
  const isAdmin = ctx.authUser.role === 'admin';
  const name = ctx.from?.first_name ?? 'друг';

  const lines = [
    `👋 Привет, *${name}*!`,
    '',
    `Я — бот для управления рекламой в *Яндекс.Директ* для бизнеса:`,
    `📍 _${config.BUSINESS_NAME}_`,
    '',
    '*Что я умею:*',
    '• Создавать кампании в Поиске и РСЯ через ИИ',
    '• Подбирать ключевики через Wordstat',
    '• Учиться на топ-объявлениях и реальных продажах',
    '• Показывать аналитику и оптимизировать',
    '',
    '*Команды:*',
    '`/health` — проверить все API',
    '`/help` — справка',
    isAdmin ? '`/grant <id>` — выдать доступ' : '',
    isAdmin ? '`/users` — список пользователей' : '',
    '',
    '_Полный функционал создания кампаний — в следующей фазе._',
  ].filter(Boolean);

  const kb = new InlineKeyboard().webApp('🚀 Открыть приложение', appUrl());
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

export async function handleHelp(ctx: SessionContext): Promise<void> {
  const lines = [
    '*Доступные команды:*',
    '',
    '`/start` — приветствие',
    '`/health` — проверить все API (Direct, Wordstat, Gemini, CRM)',
    '`/ping` — pong',
    '',
    ctx.authUser.role === 'admin' ? '*Админ-команды:*' : '',
    ctx.authUser.role === 'admin' ? '`/grant <id>` — выдать доступ пользователю' : '',
    ctx.authUser.role === 'admin' ? '`/revoke <id>` — отозвать доступ' : '',
    ctx.authUser.role === 'admin' ? '`/users` — список авторизованных' : '',
  ].filter(Boolean);

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}
