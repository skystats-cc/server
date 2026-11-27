import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// Shared price/volume columns for latest + snapshot tables
const bazaarFields = () => ({
  buyPrice: doublePrecision('buy_price').notNull(),
  sellPrice: doublePrecision('sell_price').notNull(),
  buyVolume: bigint('buy_volume', { mode: 'number' }).notNull(),
  sellVolume: bigint('sell_volume', { mode: 'number' }).notNull(),
  buyMovingWeek: bigint('buy_moving_week', { mode: 'number' }).notNull(),
  sellMovingWeek: bigint('sell_moving_week', { mode: 'number' }).notNull(),
  buyOrders: integer('buy_orders').notNull(),
  sellOrders: integer('sell_orders').notNull(),
});

// Latest state of every bazaar product. Overwritten every poll (~30s) for the realtime view.
export const bazaarProducts = pgTable('bazaar_products', {
  productId: text('product_id').primaryKey(),
  ...bazaarFields(),
  upstreamUpdatedAt: ts('upstream_updated_at').notNull(),
  polledAt: ts('polled_at').notNull(),
});

// Append-only history. One row per product per snapshot (every 2h by default).
export const bazaarSnapshots = pgTable(
  'bazaar_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => bazaarProducts.productId),
    takenAt: ts('taken_at').notNull().defaultNow(),
    ...bazaarFields(),
  },
  (t) => [
    index('bazaar_snapshots_product_taken_idx').on(t.productId, t.takenAt),
    index('bazaar_snapshots_taken_idx').on(t.takenAt), // for retention cleanup
  ],
);

// Single-row cache of status.hypixel.net (id = 'current').
export const hypixelStatus = pgTable('hypixel_status', {
  id: text('id').primaryKey(),
  indicator: text('indicator').notNull(),
  description: text('description').notNull(),
  components: jsonb('components').notNull(),
  incidents: jsonb('incidents').notNull(),
  checkedAt: ts('checked_at').notNull(),
});
