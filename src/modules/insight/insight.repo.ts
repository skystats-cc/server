import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, annotations, items, memberDaily, memberSnapshots, modEvents, playSessions, players, profileMembers } from '../../db/schema.js';

export const insightRepo = {
  // ---- sessions ----
  async latestSession(accountId: string) {
    const [r] = await db.select().from(playSessions).where(eq(playSessions.accountId, accountId)).orderBy(desc(playSessions.lastSeenAt)).limit(1);
    return r ?? null;
  },
  async startSession(accountId: string, at: Date) {
    const [r] = await db.insert(playSessions).values({ accountId, startedAt: at, lastSeenAt: at }).returning();
    return r!;
  },
  async touchSession(id: string, at: Date) {
    await db.update(playSessions).set({ lastSeenAt: at }).where(eq(playSessions.id, id));
  },
  async sessionCoins(id: string, profileId: string, coins: number, setStart: boolean) {
    await db.update(playSessions).set({ profileId, coinsEnd: coins, ...(setStart ? { coinsStart: coins } : {}) }).where(eq(playSessions.id, id));
  },
  sessions: (accountId: string, since: Date) =>
    db.select().from(playSessions).where(and(eq(playSessions.accountId, accountId), gte(playSessions.startedAt, since))).orderBy(desc(playSessions.startedAt)).limit(500),
  async tagSession(accountId: string, id: string, methodId: string | null) {
    const r = await db.update(playSessions).set({ methodId }).where(and(eq(playSessions.id, id), eq(playSessions.accountId, accountId))).returning({ id: playSessions.id });
    return r.length > 0;
  },
  taggedSessions: (accountId: string, methodId: string) =>
    db.select().from(playSessions).where(and(eq(playSessions.accountId, accountId), eq(playSessions.methodId, methodId))),
  /** Finished sessions (idle 30+ min) without an activity, for accounts that opted in */
  async unclassified(limit = 200) {
    return db
      .select({ s: playSessions })
      .from(playSessions)
      .innerJoin(accounts, eq(accounts.id, playSessions.accountId))
      .where(and(isNull(playSessions.activity), eq(accounts.activityInsights, true), lt(playSessions.lastSeenAt, new Date(Date.now() - 30 * 60_000)), gte(playSessions.lastSeenAt, new Date(Date.now() - 2 * 86_400_000))))
      .limit(limit);
  },
  async setActivity(id: string, activity: string) {
    await db.update(playSessions).set({ activity }).where(eq(playSessions.id, id));
  },

  // ---- events ----
  async addEvents(rows: (typeof modEvents.$inferInsert)[]) {
    if (rows.length) await db.insert(modEvents).values(rows);
  },
  events: (accountId: string, since: Date) =>
    db.select().from(modEvents).where(and(eq(modEvents.accountId, accountId), gte(modEvents.at, since))).orderBy(desc(modEvents.at)).limit(200),
  async eventCategories(accountId: string, from: Date, to: Date) {
    const rows = await db
      .select({ category: items.category })
      .from(modEvents)
      .leftJoin(items, eq(items.id, modEvents.itemId))
      .where(and(eq(modEvents.accountId, accountId), gte(modEvents.at, from), lt(modEvents.at, to)));
    return rows.map((r) => r.category);
  },

  // ---- money ----
  async lastSnapshot(playerUuid: string, profileId: string) {
    const [r] = await db
      .select()
      .from(memberSnapshots)
      .where(and(eq(memberSnapshots.playerUuid, playerUuid), eq(memberSnapshots.profileId, profileId), eq(memberSnapshots.source, 'mod')))
      .orderBy(desc(memberSnapshots.takenAt))
      .limit(1);
    return r ?? null;
  },
  snapshots: (playerUuid: string, profileId: string, from: Date | null) =>
    db
      .select()
      .from(memberSnapshots)
      .where(and(eq(memberSnapshots.playerUuid, playerUuid), eq(memberSnapshots.profileId, profileId), eq(memberSnapshots.source, 'mod'), from ? gte(memberSnapshots.takenAt, from) : sql`true`))
      .orderBy(asc(memberSnapshots.takenAt))
      .limit(20000),
  days: (playerUuid: string, profileId: string, fromDay: string | null) =>
    db
      .select()
      .from(memberDaily)
      .where(and(eq(memberDaily.playerUuid, playerUuid), eq(memberDaily.profileId, profileId), fromDay ? gte(memberDaily.day, fromDay) : sql`true`))
      .orderBy(asc(memberDaily.day)),

  // ---- annotations ----
  annotations: (accountId: string, profileId: string) =>
    db.select().from(annotations).where(and(eq(annotations.accountId, accountId), eq(annotations.profileId, profileId))).orderBy(asc(annotations.at)),
  async addAnnotation(v: typeof annotations.$inferInsert) {
    const [r] = await db.insert(annotations).values(v).returning();
    return r!;
  },
  async deleteAnnotation(accountId: string, id: string) {
    const r = await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.accountId, accountId))).returning({ id: annotations.id });
    return r.length > 0;
  },
  async countAnnotations(accountId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(annotations).where(eq(annotations.accountId, accountId));
    return r?.n ?? 0;
  },

  // ---- co-op ----
  async coopMembers(profileId: string) {
    return db
      .select({
        uuid: profileMembers.playerUuid,
        username: players.username,
        active: profileMembers.active,
        firstJoin: profileMembers.firstJoin,
        updatedAt: profileMembers.updatedAt,
        accountId: accounts.id,
        hideBank: accounts.hideBank,
        allowActivityPings: accounts.allowActivityPings,
        trackingEnabled: accounts.trackingEnabled,
        modLastSeenAt: accounts.modLastSeenAt,
      })
      .from(profileMembers)
      .innerJoin(players, eq(players.uuid, profileMembers.playerUuid))
      .leftJoin(accounts, eq(accounts.playerUuid, profileMembers.playerUuid))
      .where(eq(profileMembers.profileId, profileId));
  },
  async sessionsOf(accountIds: string[], since: Date) {
    if (accountIds.length === 0) return [];
    return db.select().from(playSessions).where(and(inArray(playSessions.accountId, accountIds), gte(playSessions.startedAt, since))).orderBy(desc(playSessions.startedAt)).limit(100);
  },
  async snapshotsOf(uuids: string[], profileId: string, since: Date) {
    if (uuids.length === 0) return [];
    return db
      .select()
      .from(memberSnapshots)
      .where(and(inArray(memberSnapshots.playerUuid, uuids), eq(memberSnapshots.profileId, profileId), eq(memberSnapshots.source, 'mod'), gte(memberSnapshots.takenAt, since)))
      .orderBy(asc(memberSnapshots.takenAt));
  },

  // ---- retention ----
  async deleteBefore(accountId: string, before: Date) {
    await db.delete(modEvents).where(and(eq(modEvents.accountId, accountId), lt(modEvents.at, before)));
    await db.delete(playSessions).where(and(eq(playSessions.accountId, accountId), lt(playSessions.startedAt, before)));
  },
};
