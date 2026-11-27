import { and, eq, gt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { pairings } from '../../db/schema.js';

export const pairingRepo = {
  /** Returns null if the code collided with an existing one (caller retries) */
  async create(code: string, secretHash: string, expiresAt: Date, discord?: { id: string; username: string | null }) {
    const rows = await db
      .insert(pairings)
      .values({ code, secretHash, expiresAt, discordId: discord?.id, discordUsername: discord?.username })
      .onConflictDoNothing({ target: pairings.code })
      .returning({ id: pairings.id });
    return rows[0]?.id ?? null;
  },

  async get(id: string) {
    const [row] = await db.select().from(pairings).where(eq(pairings.id, id)).limit(1);
    return row ?? null;
  },

  async findByCode(code: string) {
    const [row] = await db.select().from(pairings).where(eq(pairings.code, code)).limit(1);
    return row ?? null;
  },

  /** Atomically link a pending, unexpired code to an account. Returns null if someone got there first. */
  async link(code: string, accountId: string) {
    const rows = await db
      .update(pairings)
      .set({ status: 'linked', accountId, linkedAt: new Date() })
      .where(and(eq(pairings.code, code), eq(pairings.status, 'pending'), gt(pairings.expiresAt, new Date())))
      .returning({ id: pairings.id, discordId: pairings.discordId, discordUsername: pairings.discordUsername });
    return rows[0] ?? null;
  },

  /** Atomically mark a linked pairing as used (so the browser gets exactly one session) */
  async consume(id: string) {
    const rows = await db
      .update(pairings)
      .set({ status: 'consumed' })
      .where(and(eq(pairings.id, id), eq(pairings.status, 'linked')))
      .returning({ accountId: pairings.accountId });
    return rows[0]?.accountId ?? null;
  },
};
