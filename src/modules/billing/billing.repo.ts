import { db } from '../../db/client.js';
import { stripeEvents } from '../../db/schema.js';

export const billingRepo = {
  /** True the first time an event id is seen. */
  async markEvent(id: string, type: string) {
    const rows = await db.insert(stripeEvents).values({ id, type }).onConflictDoNothing().returning({ id: stripeEvents.id });
    return rows.length > 0;
  },
};
