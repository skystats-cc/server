import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { auditLog } from '../../db/schema.js';

export type AuditActor = 'user' | 'admin' | 'system' | 'stripe';

/** Append-only. Never put secrets, tokens or payment details in `details`. */
export const audit = {
  async log(actor: AuditActor, action: string, accountId: string | null, details: Record<string, unknown> = {}) {
    await db.insert(auditLog).values({ actor, action, accountId, details });
  },
  /** How often this account did `action` recently (abuse limits, e.g. failed pairing codes) */
  async countRecent(accountId: string, action: string, minutes: number) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.accountId, accountId), eq(auditLog.action, action), gt(auditLog.at, new Date(Date.now() - minutes * 60_000))));
    return r?.n ?? 0;
  },
};
