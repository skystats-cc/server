import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  accounts,
  alertRules,
  bazaarProducts,
  bazaarSnapshots,
  discordIdentities,
  entitlements,
  memberDaily,
  moneyGoals,
  notificationPrefs,
  notifications,
  players,
  profileMembers,
  skyblockElection,
  skyblockNews,
} from '../../db/schema.js';

export type PrefsRow = typeof notificationPrefs.$inferSelect;
export type RuleRow = typeof alertRules.$inferSelect;
export type NewNotification = {
  accountId: string;
  kind: string;
  title: string;
  body: string;
  url?: string | null;
  dedupeKey?: string | null;
  deliverAfter: Date;
  dmStatus: 'none' | 'pending';
};

export const alertsRepo = {
  // ---- prefs ----
  async prefs(accountId: string): Promise<PrefsRow | null> {
    const [row] = await db.select().from(notificationPrefs).where(eq(notificationPrefs.accountId, accountId)).limit(1);
    return row ?? null;
  },
  async savePrefs(accountId: string, set: Partial<Omit<PrefsRow, 'accountId' | 'updatedAt'>>) {
    const values = { ...set, updatedAt: new Date() };
    await db.insert(notificationPrefs).values({ accountId, ...values }).onConflictDoUpdate({ target: notificationPrefs.accountId, set: values });
  },
  async prefsWhere(column: 'dailyDigest' | 'weeklyRecap' | 'mayorReminder' | 'patchNotes' | 'outages' | 'coopActivity') {
    return db
      .select({ prefs: notificationPrefs, tier: entitlements.tier, status: entitlements.status, currentPeriodEnd: entitlements.currentPeriodEnd, graceUntil: entitlements.graceUntil, playerUuid: accounts.playerUuid })
      .from(notificationPrefs)
      .innerJoin(accounts, eq(accounts.id, notificationPrefs.accountId))
      .leftJoin(entitlements, eq(entitlements.accountId, notificationPrefs.accountId))
      .where(eq(notificationPrefs[column], true));
  },
  async hasDiscord(accountId: string) {
    const [row] = await db.select({ id: discordIdentities.discordId }).from(discordIdentities).where(eq(discordIdentities.accountId, accountId)).limit(1);
    return Boolean(row);
  },

  // ---- rules ----
  listRules: (accountId: string) => db.select().from(alertRules).where(eq(alertRules.accountId, accountId)).orderBy(asc(alertRules.createdAt)),
  async countRules(accountId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(alertRules).where(eq(alertRules.accountId, accountId));
    return r?.n ?? 0;
  },
  async createRule(v: typeof alertRules.$inferInsert) {
    const [row] = await db.insert(alertRules).values(v).returning();
    return row!;
  },
  async deleteRule(accountId: string, id: string) {
    const rows = await db.delete(alertRules).where(and(eq(alertRules.id, id), eq(alertRules.accountId, accountId))).returning({ id: alertRules.id });
    return rows.length > 0;
  },
  /** Active rules of a kind with each owner's billing state */
  async activeRules(kind: string) {
    return db
      .select({ rule: alertRules, tier: entitlements.tier, status: entitlements.status, currentPeriodEnd: entitlements.currentPeriodEnd, graceUntil: entitlements.graceUntil })
      .from(alertRules)
      .leftJoin(entitlements, eq(entitlements.accountId, alertRules.accountId))
      .where(and(eq(alertRules.kind, kind), eq(alertRules.active, true)));
  },
  async updateRuleState(id: string, set: { armed: boolean; lastFiredAt?: Date }) {
    await db.update(alertRules).set(set).where(eq(alertRules.id, id));
  },

  // ---- market data ----
  async latestPrices(productIds: string[]) {
    if (productIds.length === 0) return [];
    return db.select().from(bazaarProducts).where(inArray(bazaarProducts.productId, productIds));
  },
  async snapshotsSince(productIds: string[], since: Date) {
    if (productIds.length === 0) return [];
    return db
      .select()
      .from(bazaarSnapshots)
      .where(and(inArray(bazaarSnapshots.productId, productIds), gte(bazaarSnapshots.takenAt, since)))
      .orderBy(asc(bazaarSnapshots.takenAt));
  },
  async movers(since: Date, limit = 3) {
    const rows = await db.execute(sql`
      select p.product_id as "productId", p.buy_price as now, s.buy_price as then
      from bazaar_products p
      join lateral (select buy_price from bazaar_snapshots s where s.product_id = p.product_id and s.taken_at >= ${since.toISOString()}::timestamptz order by taken_at asc limit 1) s on true
      where s.buy_price > 0 and p.buy_moving_week > 1000
      order by abs(ln(p.buy_price / s.buy_price)) desc
      limit ${limit}`);
    return rows as unknown as { productId: string; now: number; then: number }[];
  },
  async productExists(productId: string) {
    const [r] = await db.select({ id: bazaarProducts.productId }).from(bazaarProducts).where(eq(bazaarProducts.productId, productId)).limit(1);
    return Boolean(r);
  },

  // ---- goals ----
  listGoals: (accountId: string) => db.select().from(moneyGoals).where(eq(moneyGoals.accountId, accountId)).orderBy(asc(moneyGoals.createdAt)),
  async createGoal(accountId: string, profileId: string, target: number) {
    const [row] = await db.insert(moneyGoals).values({ accountId, profileId, target }).returning();
    return row!;
  },
  async deleteGoal(accountId: string, id: string) {
    const rows = await db.delete(moneyGoals).where(and(eq(moneyGoals.id, id), eq(moneyGoals.accountId, accountId))).returning({ id: moneyGoals.id });
    return rows.length > 0;
  },
  /** Unreached goals for this profile at or below `total`; marks them reached */
  async reachGoals(accountId: string, profileId: string, total: number) {
    return db
      .update(moneyGoals)
      .set({ reachedAt: new Date() })
      .where(and(eq(moneyGoals.accountId, accountId), eq(moneyGoals.profileId, profileId), isNull(moneyGoals.reachedAt), lte(moneyGoals.target, total)))
      .returning();
  },

  // ---- coin summaries ----
  async dailyChange(playerUuid: string, fromDay: string, toDay: string) {
    const rows = await db
      .select({ day: memberDaily.day, open: memberDaily.openTotal, close: memberDaily.closeTotal })
      .from(memberDaily)
      .where(and(eq(memberDaily.playerUuid, playerUuid), gte(memberDaily.day, fromDay), lte(memberDaily.day, toDay)))
      .orderBy(asc(memberDaily.day));
    if (rows.length === 0) return null;
    return (rows[rows.length - 1]!.close ?? 0) - (rows[0]!.open ?? 0);
  },

  // ---- co-op ----
  /** Other SkyStats accounts in this player's active co-ops */
  async coopMates(playerUuid: string) {
    const mine = db.select({ id: profileMembers.profileId }).from(profileMembers).where(and(eq(profileMembers.playerUuid, playerUuid), eq(profileMembers.active, true)));
    return db
      .selectDistinct({ accountId: accounts.id, playerUuid: accounts.playerUuid })
      .from(profileMembers)
      .innerJoin(accounts, eq(accounts.playerUuid, profileMembers.playerUuid))
      .where(and(inArray(profileMembers.profileId, mine), eq(profileMembers.active, true), ne(profileMembers.playerUuid, playerUuid)));
  },
  async username(uuid: string) {
    const [r] = await db.select({ u: players.username }).from(players).where(eq(players.uuid, uuid)).limit(1);
    return r?.u ?? null;
  },

  // ---- notifications ----
  /** Returns false when the dedupe key was already used for this account */
  async insertNotification(n: NewNotification) {
    const rows = await db.insert(notifications).values(n).onConflictDoNothing().returning({ id: notifications.id });
    return rows.length > 0;
  },
  listNotifications: (accountId: string, limit = 50) =>
    db.select().from(notifications).where(eq(notifications.accountId, accountId)).orderBy(desc(notifications.createdAt)).limit(limit),
  async markAllRead(accountId: string) {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.accountId, accountId), isNull(notifications.readAt)));
  },
  /** Bot: claim due DMs atomically (pending → sending) */
  async claimDue(limit: number) {
    const rows = await db.execute(sql`
      update notifications n set dm_status = 'sending'
      from discord_identities d
      where n.id in (select id from notifications where dm_status = 'pending' and deliver_after <= now() order by id limit ${limit} for update skip locked)
        and d.account_id = n.account_id
      returning n.id, n.kind, n.title, n.body, n.url, d.discord_id as "discordId"`);
    return rows as unknown as { id: number; kind: string; title: string; body: string; url: string | null; discordId: string }[];
  },
  async setDmStatus(id: number, status: 'sent' | 'failed') {
    await db.update(notifications).set({ dmStatus: status }).where(eq(notifications.id, id));
  },
  /** Stuck "sending" (bot crashed) back to pending; old notifications removed */
  async maintenance() {
    await db.update(notifications).set({ dmStatus: 'pending' }).where(and(eq(notifications.dmStatus, 'sending'), lt(notifications.deliverAfter, new Date(Date.now() - 15 * 60_000))));
    await db.delete(notifications).where(lt(notifications.createdAt, new Date(Date.now() - 90 * 86_400_000)));
  },

  // ---- news & election ----
  async upsertNews(items: { id: string; title: string; publishedAt: Date | null }[]) {
    if (items.length === 0) return [];
    return db.insert(skyblockNews).values(items).onConflictDoNothing().returning();
  },
  listNews: (limit = 20) => db.select().from(skyblockNews).orderBy(desc(skyblockNews.publishedAt)).limit(limit),
  async unannouncedNews() {
    return db.select().from(skyblockNews).where(isNull(skyblockNews.announcedAt)).orderBy(asc(skyblockNews.publishedAt));
  },
  async markAnnounced(id: string) {
    await db.update(skyblockNews).set({ announcedAt: new Date() }).where(eq(skyblockNews.id, id));
  },
  async election() {
    const [row] = await db.select().from(skyblockElection).where(eq(skyblockElection.id, 'current')).limit(1);
    return row ?? null;
  },
  async saveElection(v: Omit<typeof skyblockElection.$inferInsert, 'id'>) {
    await db.insert(skyblockElection).values({ id: 'current', ...v }).onConflictDoUpdate({ target: skyblockElection.id, set: v });
  },
};
