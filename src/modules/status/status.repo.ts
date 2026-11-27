import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { hypixelStatus } from '../../db/schema.js';

const ROW_ID = 'current';
export type StatusRow = Omit<typeof hypixelStatus.$inferInsert, 'id'>;

export const statusRepo = {
  async save(row: StatusRow) {
    const values = { id: ROW_ID, ...row };
    await db.insert(hypixelStatus).values(values).onConflictDoUpdate({ target: hypixelStatus.id, set: values });
  },
  async get() {
    const [row] = await db.select().from(hypixelStatus).where(eq(hypixelStatus.id, ROW_ID)).limit(1);
    return row ?? null;
  },
};
