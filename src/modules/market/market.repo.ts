import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  auctionPrices,
  auctionSales,
  bazaarAnomalies,
  bazaarCorrelations,
  bazaarProducts,
  bazaarSnapshots,
  customMethods,
  electionHistory,
  items,
  lowestBins,
  methodValues,
  methodVotes,
  recipes,
  watchlist,
} from '../../db/schema.js';

export const marketRepo = {
  // ---- items & recipes ----
  async upsertItems(rows: (typeof items.$inferInsert)[]) {
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(items)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: items.id,
          set: { name: sql`excluded.name`, category: sql`excluded.category`, tier: sql`excluded.tier`, npcSellPrice: sql`excluded.npc_sell_price`, updatedAt: sql`excluded.updated_at` },
        });
    }
  },
  allItems: () => db.select().from(items),
  async searchItems(q: string, limit = 25) {
    return db.select().from(items).where(sql`${items.name} ilike ${'%' + q + '%'} or ${items.id} ilike ${'%' + q + '%'}`).orderBy(asc(items.name)).limit(limit);
  },
  async upsertRecipe(r: typeof recipes.$inferInsert) {
    await db.insert(recipes).values(r).onConflictDoUpdate({ target: recipes.outputId, set: { outputCount: r.outputCount, inputs: r.inputs, updatedAt: r.updatedAt } });
  },
  allRecipes: () => db.select().from(recipes),

  // ---- bazaar ----
  allQuotes: () => db.select().from(bazaarProducts),
  async product(id: string) {
    const [r] = await db.select().from(bazaarProducts).where(eq(bazaarProducts.productId, id)).limit(1);
    return r ?? null;
  },
  async history(ids: string[], since: Date) {
    if (ids.length === 0) return [];
    return db.select().from(bazaarSnapshots).where(and(inArray(bazaarSnapshots.productId, ids), gte(bazaarSnapshots.takenAt, since))).orderBy(asc(bazaarSnapshots.takenAt));
  },
  /** Price now vs. the first snapshot after `since`, for every product */
  async changes(since: Date) {
    return (await db.execute(sql`
      select p.product_id as "productId", p.buy_price as "now", s.buy_price as "then", p.buy_moving_week as "weekVolume",
             p.buy_volume as "buyVolume", s.buy_volume as "thenBuyVolume"
      from bazaar_products p
      join lateral (select buy_price, buy_volume from bazaar_snapshots s where s.product_id = p.product_id and s.taken_at >= ${since.toISOString()}::timestamptz order by taken_at asc limit 1) s on true
      where s.buy_price > 0 and p.buy_price > 0`)) as unknown as { productId: string; now: number; then: number; weekVolume: number; buyVolume: number; thenBuyVolume: number }[];
  },
  async topByVolume(n: number) {
    return db.select({ id: bazaarProducts.productId }).from(bazaarProducts).orderBy(desc(sql`least(${bazaarProducts.buyMovingWeek}, ${bazaarProducts.sellMovingWeek})`)).limit(n);
  },

  // ---- anomalies & correlations ----
  async addAnomalies(rows: { productId: string; z: number; price: number }[]) {
    if (rows.length) await db.insert(bazaarAnomalies).values(rows);
    await db.delete(bazaarAnomalies).where(lt(bazaarAnomalies.detectedAt, new Date(Date.now() - 30 * 86_400_000)));
  },
  recentAnomalies: (limit = 50) => db.select().from(bazaarAnomalies).orderBy(desc(bazaarAnomalies.detectedAt)).limit(limit),
  async replaceCorrelations(rows: (typeof bazaarCorrelations.$inferInsert)[]) {
    await db.transaction(async (tx) => {
      await tx.delete(bazaarCorrelations);
      for (let i = 0; i < rows.length; i += 1000) await tx.insert(bazaarCorrelations).values(rows.slice(i, i + 1000));
    });
  },
  correlationsFor: (id: string, limit = 10) =>
    db.select().from(bazaarCorrelations).where(eq(bazaarCorrelations.productId, id)).orderBy(desc(sql`abs(${bazaarCorrelations.r})`)).limit(limit),

  // ---- auctions ----
  async addSales(rows: (typeof auctionSales.$inferInsert)[]) {
    if (rows.length) await db.insert(auctionSales).values(rows).onConflictDoNothing();
  },
  /** Roll raw sales into hourly medians; drop raw sales older than 2 days */
  async rollupSales() {
    await db.execute(sql`
      insert into auction_prices (item_id, hour, sales, median, min)
      select item_id, date_trunc('hour', sold_at), count(*)::int,
             percentile_cont(0.5) within group (order by price_per_unit), min(price_per_unit)
      from auction_sales where sold_at >= now() - interval '3 hours'
      group by 1, 2
      on conflict (item_id, hour) do update set sales = excluded.sales, median = excluded.median, min = excluded.min`);
    await db.delete(auctionSales).where(lt(auctionSales.soldAt, new Date(Date.now() - 2 * 86_400_000)));
  },
  async replaceLowestBins(rows: (typeof lowestBins.$inferInsert)[]) {
    await db.transaction(async (tx) => {
      await tx.delete(lowestBins);
      for (let i = 0; i < rows.length; i += 1000) await tx.insert(lowestBins).values(rows.slice(i, i + 1000));
    });
  },
  allLowestBins: () => db.select().from(lowestBins),
  async lowestBin(id: string) {
    const [r] = await db.select().from(lowestBins).where(eq(lowestBins.itemId, id)).limit(1);
    return r ?? null;
  },
  auctionHistory: (id: string, since: Date) =>
    db.select().from(auctionPrices).where(and(eq(auctionPrices.itemId, id), gte(auctionPrices.hour, since))).orderBy(asc(auctionPrices.hour)),

  // ---- watchlist ----
  watchlist: (accountId: string) => db.select().from(watchlist).where(eq(watchlist.accountId, accountId)).orderBy(asc(watchlist.createdAt)),
  async watch(accountId: string, productId: string) {
    await db.insert(watchlist).values({ accountId, productId }).onConflictDoNothing();
  },
  async unwatch(accountId: string, productId: string) {
    await db.delete(watchlist).where(and(eq(watchlist.accountId, accountId), eq(watchlist.productId, productId)));
  },
  async watchCount(accountId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(watchlist).where(eq(watchlist.accountId, accountId));
    return r?.n ?? 0;
  },

  // ---- elections ----
  async recordMayor(year: number, mayor: string | null, perks: unknown) {
    await db.insert(electionHistory).values({ year, mayor, perks }).onConflictDoNothing();
  },
  electionHistory: () => db.select().from(electionHistory).orderBy(asc(electionHistory.year)),

  // ---- methods ----
  customMethods: (accountId: string) => db.select().from(customMethods).where(eq(customMethods.accountId, accountId)).orderBy(asc(customMethods.createdAt)),
  async customMethod(id: string) {
    const [r] = await db.select().from(customMethods).where(eq(customMethods.id, id)).limit(1);
    return r ?? null;
  },
  async createCustom(accountId: string, name: string, spec: unknown) {
    const [r] = await db.insert(customMethods).values({ accountId, name, spec }).returning();
    return r!;
  },
  async updateCustom(accountId: string, id: string, name: string, spec: unknown) {
    const [r] = await db.update(customMethods).set({ name, spec, updatedAt: new Date() }).where(and(eq(customMethods.id, id), eq(customMethods.accountId, accountId))).returning();
    return r ?? null;
  },
  async deleteCustom(accountId: string, id: string) {
    const r = await db.delete(customMethods).where(and(eq(customMethods.id, id), eq(customMethods.accountId, accountId))).returning({ id: customMethods.id });
    return r.length > 0;
  },
  async countCustom(accountId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(customMethods).where(eq(customMethods.accountId, accountId));
    return r?.n ?? 0;
  },
  async recordMethodValues(rows: { methodId: string; value: number }[]) {
    if (rows.length === 0) return;
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await db.insert(methodValues).values(rows.map((r) => ({ ...r, hour }))).onConflictDoUpdate({ target: [methodValues.methodId, methodValues.hour], set: { value: sql`excluded.value` } });
  },
  methodHistory: (id: string, since: Date) =>
    db.select({ hour: methodValues.hour, value: methodValues.value }).from(methodValues).where(and(eq(methodValues.methodId, id), gte(methodValues.hour, since))).orderBy(asc(methodValues.hour)),
  async vote(methodId: string, accountId: string, v: { vote: number; stillWorks: boolean | null; difficulty: number | null }) {
    await db.insert(methodVotes).values({ methodId, accountId, ...v }).onConflictDoUpdate({ target: [methodVotes.methodId, methodVotes.accountId], set: { ...v, updatedAt: new Date() } });
  },
  async voteSummary() {
    return (await db.execute(sql`
      select method_id as "methodId", coalesce(sum(vote), 0)::int as score, count(*)::int as votes,
             avg(difficulty)::float as difficulty,
             (count(*) filter (where still_works))::int as "worksYes", (count(*) filter (where still_works = false))::int as "worksNo"
      from method_votes group by method_id`)) as unknown as { methodId: string; score: number; votes: number; difficulty: number | null; worksYes: number; worksNo: number }[];
  },
};
