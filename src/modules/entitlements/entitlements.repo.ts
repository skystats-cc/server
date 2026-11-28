import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { entitlements } from '../../db/schema.js';

export type EntitlementRow = typeof entitlements.$inferSelect;

export const entitlementsRepo = {
  async get(accountId: string): Promise<EntitlementRow | null> {
    const [row] = await db.select().from(entitlements).where(eq(entitlements.accountId, accountId)).limit(1);
    return row ?? null;
  },

  async byCustomer(stripeCustomerId: string) {
    const [row] = await db.select().from(entitlements).where(eq(entitlements.stripeCustomerId, stripeCustomerId)).limit(1);
    return row ?? null;
  },

  async upsert(accountId: string, set: Partial<Omit<EntitlementRow, 'accountId'>>) {
    const values = { ...set, updatedAt: new Date() };
    await db
      .insert(entitlements)
      .values({ accountId, ...values })
      .onConflictDoUpdate({ target: entitlements.accountId, set: values });
  },

  all: () => db.select().from(entitlements),
};
