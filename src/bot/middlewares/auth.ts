import type { Context, NextFunction } from 'grammy';
import { db } from '../../lib/db.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

let bootstrappedAdminId: bigint | null = null;

/** Insert bootstrap admin once at startup if missing. */
export async function ensureBootstrapAdmin(): Promise<void> {
  const targetId = BigInt(config.BOOTSTRAP_ADMIN_TG_ID);
  const existing = await db.authorizedUser.findUnique({
    where: { telegramId: targetId },
  });
  if (!existing) {
    await db.authorizedUser.create({
      data: { telegramId: targetId, role: 'admin', grantedBy: targetId },
    });
    logger.info({ telegramId: targetId.toString() }, '👑 bootstrap admin created');
  } else if (existing.role !== 'admin') {
    await db.authorizedUser.update({
      where: { telegramId: targetId },
      data: { role: 'admin' },
    });
    logger.info({ telegramId: targetId.toString() }, '👑 bootstrap user promoted to admin');
  }
  bootstrappedAdminId = targetId;
}

export interface AuthorizedContext extends Context {
  authUser: {
    telegramId: bigint;
    role: 'admin' | 'user';
  };
}

/**
 * Block messages from users not in the whitelist.
 * Updates lastSeenAt for authorized users.
 */
export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return; // ignore non-user updates

  const user = await db.authorizedUser.findUnique({
    where: { telegramId: BigInt(userId) },
  });

  if (!user) {
    logger.warn(
      { userId, username: ctx.from?.username },
      'unauthorized access attempt'
    );
    await ctx.reply(
      `🚫 У вас нет доступа.\n\nВаш ID: \`${userId}\`\n\nПопросите администратора выдать доступ командой:\n\`/grant ${userId}\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Update lastSeen and capture identity drift.
  void db.authorizedUser
    .update({
      where: { telegramId: user.telegramId },
      data: {
        lastSeenAt: new Date(),
        username: ctx.from?.username ?? user.username,
        firstName: ctx.from?.first_name ?? user.firstName,
        lastName: ctx.from?.last_name ?? user.lastName,
      },
    })
    .catch(() => {});

  (ctx as AuthorizedContext).authUser = {
    telegramId: user.telegramId,
    role: user.role as 'admin' | 'user',
  };

  await next();
}

/** Reject if not admin. Use after authMiddleware. */
export async function requireAdmin(
  ctx: AuthorizedContext,
  next: NextFunction
): Promise<void> {
  if (ctx.authUser?.role !== 'admin') {
    await ctx.reply('🚫 Только администраторы могут использовать эту команду.');
    return;
  }
  await next();
}

export function getBootstrappedAdminId(): bigint | null {
  return bootstrappedAdminId;
}
