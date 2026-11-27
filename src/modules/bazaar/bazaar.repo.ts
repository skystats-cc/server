import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { bazaarProducts, bazaarSnapshots } from '../../db/schema.js';

export type BazaarRow = typeof bazaarProducts.$inferInsert;

const excluded = (col: string) => sql.raw(`excluded.${col}`);

export const bazaarRepo = {
  async upsertLatest(rows: BazaarRow[]) {
    if (rows.length === 0) return;
    await db
      .insert(bazaarProducts)
      .values(rows)
      .onConflictDoUpdate({
        target: bazaarProducts.productId,
        set: {
          buyPrice: excluded('buy_price'),
          sellPrice: excluded('sell_price'),
          buyVolume: excluded('buy_volume'),
          sellVolume: excluded('sell_volume'),
          buyMovingWeek: excluded('buy_moving_week'),
          sellMovingWeek: excluded('sell_moving_week'),
          buyOrders: excluded('buy_orders'),
          sellOrders: excluded('sell_orders'),
          upstreamUpdatedAt: excluded('upstream_updated_at'),
          polledAt: excluded('polled_at'),
          buySummary: excluded('buy_summary'),
          sellSummary: excluded('sell_summary'),
        },
      });
  },

  async list() {
    return db.select().from(bazaarProducts).orderBy(asc(bazaarProducts.productId));
  },

  async find(productId: string) {
    const [row] = await db
      .select()
      .from(bazaarProducts)
      .where(eq(bazaarProducts.productId, productId))
      .limit(1);
    return row ?? null;
  },

  async history(productId: string, since: Date) {
    return db
      .select({
        takenAt: bazaarSnapshots.takenAt,
        buyPrice: bazaarSnapshots.buyPrice,
        sellPrice: bazaarSnapshots.sellPrice,
        buyVolume: bazaarSnapshots.buyVolume,
        sellVolume: bazaarSnapshots.sellVolume,
        buyMovingWeek: bazaarSnapshots.buyMovingWeek,
        sellMovingWeek: bazaarSnapshots.sellMovingWeek,
      })
      .from(bazaarSnapshots)
      .where(and(eq(bazaarSnapshots.productId, productId), gte(bazaarSnapshots.takenAt, since)))
      .orderBy(asc(bazaarSnapshots.takenAt));
  },

  // Copy the current state of every product into history in one statement.
  async snapshotAll(): Promise<number> {
    const result = await db.execute(sql`
      insert into bazaar_snapshots
        (product_id, taken_at, buy_price, sell_price, buy_volume, sell_volume,
         buy_moving_week, sell_moving_week, buy_orders, sell_orders)
      select product_id, now(), buy_price, sell_price, buy_volume, sell_volume,
             buy_moving_week, sell_moving_week, buy_orders, sell_orders
      from bazaar_products
    `);
    return result.count;
  },
};
