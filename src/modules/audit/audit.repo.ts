import { db } from '../../db/client.js';
import { auditLog } from '../../db/schema.js';

export type AuditActor = 'user' | 'admin' | 'system' | 'stripe';

/** Append-only. Never put secrets, tokens or payment details in `details`. */
export const audit = {
  async log(actor: AuditActor, action: string, accountId: string | null, details: Record<string, unknown> = {}) {
    await db.insert(auditLog).values({ actor, action, accountId, details });
  },
};
