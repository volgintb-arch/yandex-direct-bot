import type { NextFunction } from 'grammy';
import { db } from '../../lib/db.js';
import type { AuthorizedContext } from './auth.js';

export type SessionState =
  | 'idle'
  | 'awaiting_revision_text'
  | 'awaiting_cpl'
  | 'awaiting_image_for_network'
  | 'awaiting_image_caption';

export interface SessionData {
  chatId: bigint;
  userId: bigint;
  state: SessionState;
  pendingApprovalId: string | null;
  context: Record<string, unknown>;
}

export interface SessionContext extends AuthorizedContext {
  session: SessionData;
  saveSession: () => Promise<void>;
}

export async function sessionMiddleware(
  ctx: AuthorizedContext,
  next: NextFunction
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) {
    await next();
    return;
  }

  const cid = BigInt(chatId);
  const existing = await db.session.findUnique({ where: { chatId: cid } });
  const session: SessionData = existing
    ? {
        chatId: existing.chatId,
        userId: existing.userId,
        state: existing.state as SessionState,
        pendingApprovalId: existing.pendingApprovalId,
        context: (existing.context as Record<string, unknown>) ?? {},
      }
    : {
        chatId: cid,
        userId: BigInt(userId),
        state: 'idle',
        pendingApprovalId: null,
        context: {},
      };

  const sctx = ctx as SessionContext;
  sctx.session = session;
  sctx.saveSession = async () => {
    await db.session.upsert({
      where: { chatId: cid },
      create: {
        chatId: cid,
        userId: BigInt(userId),
        state: session.state,
        pendingApprovalId: session.pendingApprovalId,
        context: session.context as object,
      },
      update: {
        state: session.state,
        pendingApprovalId: session.pendingApprovalId,
        context: session.context as object,
      },
    });
  };

  await next();
}

/** Reset session to idle. */
export async function resetSession(chatId: bigint): Promise<void> {
  await db.session.update({
    where: { chatId },
    data: { state: 'idle', pendingApprovalId: null, context: {} },
  });
}
