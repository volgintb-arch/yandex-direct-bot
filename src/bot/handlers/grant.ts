import type { SessionContext } from '../middlewares/session.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

function parseTargetId(text: string | undefined): bigint | null {
  if (!text) return null;
  const m = text.match(/^\/\w+\s+(\d{5,15})/);
  if (!m) return null;
  try {
    return BigInt(m[1]!);
  } catch {
    return null;
  }
}

export async function handleGrant(ctx: SessionContext): Promise<void> {
  const targetId = parseTargetId(ctx.message?.text);
  if (!targetId) {
    await ctx.reply('Использование: `/grant <telegram_id>`', { parse_mode: 'Markdown' });
    return;
  }

  const existing = await db.authorizedUser.findUnique({ where: { telegramId: targetId } });
  if (existing) {
    await ctx.reply(`ℹ️ Пользователь \`${targetId}\` уже имеет доступ (роль: ${existing.role}).`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  await db.authorizedUser.create({
    data: { telegramId: targetId, role: 'user', grantedBy: ctx.authUser.telegramId },
  });
  logger.info(
    { targetId: targetId.toString(), grantedBy: ctx.authUser.telegramId.toString() },
    'access granted'
  );

  await ctx.reply(`✅ Доступ выдан пользователю \`${targetId}\`.`, { parse_mode: 'Markdown' });
}

export async function handleRevoke(ctx: SessionContext): Promise<void> {
  const targetId = parseTargetId(ctx.message?.text);
  if (!targetId) {
    await ctx.reply('Использование: `/revoke <telegram_id>`', { parse_mode: 'Markdown' });
    return;
  }
  if (targetId === ctx.authUser.telegramId) {
    await ctx.reply('❌ Нельзя отозвать доступ самому себе.');
    return;
  }

  const existing = await db.authorizedUser.findUnique({ where: { telegramId: targetId } });
  if (!existing) {
    await ctx.reply(`Пользователь \`${targetId}\` не найден.`, { parse_mode: 'Markdown' });
    return;
  }

  await db.authorizedUser.delete({ where: { telegramId: targetId } });
  logger.info(
    { targetId: targetId.toString(), revokedBy: ctx.authUser.telegramId.toString() },
    'access revoked'
  );

  await ctx.reply(`🗑 Доступ пользователя \`${targetId}\` отозван.`, { parse_mode: 'Markdown' });
}

export async function handleUsers(ctx: SessionContext): Promise<void> {
  const users = await db.authorizedUser.findMany({
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  if (users.length === 0) {
    await ctx.reply('Список пользователей пуст.');
    return;
  }
  const lines = ['*Авторизованные пользователи:*', ''];
  for (const u of users) {
    const tag = u.username ? `@${u.username}` : (u.firstName ?? '');
    const lastSeen = u.lastSeenAt ? `, был ${u.lastSeenAt.toISOString().slice(0, 10)}` : '';
    const roleIcon = u.role === 'admin' ? '👑' : '👤';
    lines.push(`${roleIcon} \`${u.telegramId}\` ${tag}${lastSeen}`);
  }
  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}
