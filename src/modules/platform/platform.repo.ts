import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, apiKeys, entitlements, featureFlags, jobRuns, players, sessions, webhooks } from '../../db/schema.js';

export const platformRepo = {
  // ---- api keys ----
  async createKey(v: typeof apiKeys.$inferInsert) {
    const [r] = await db.insert(apiKeys).values(v).returning();
    return r!;
  },
  listKeys: (accountId: string) =>
    db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt }).from(apiKeys).where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt)),
  async countKeys(accountId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(apiKeys).where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)));
    return r?.n ?? 0;
  },
  async revokeKey(accountId: string, id: string) {
    const r = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
    return r.length > 0;
  },
  async keyByHash(hash: string) {
    const [r] = await db
      .select({ id: apiKeys.id, accountId: apiKeys.accountId, playerUuid: accounts.playerUuid, lastUsedAt: apiKeys.lastUsedAt, bannedAt: accounts.bannedAt })
      .from(apiKeys)
      .innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
      .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return r ?? null;
  },
  async touchKey(id: string) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  },

  // ---- webhooks ----
  async createWebhook(v: typeof webhooks.$inferInsert) {
    const [r] = await db.insert(webhooks).values(v).returning();
    return r!;
  },
  listWebhooks: (accountId: string) => db.select().from(webhooks).where(eq(webhooks.accountId, accountId)),
  activeWebhooks: (accountId: string) => db.select().from(webhooks).where(and(eq(webhooks.accountId, accountId), eq(webhooks.active, true))),
  async webhook(id: string) {
    const [r] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
    return r ?? null;
  },
  async deleteWebhook(accountId: string, id: string) {
    const r = await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId))).returning({ id: webhooks.id });
    return r.length > 0;
  },
  async webhookResult(id: string, status: number, ok: boolean) {
    await db
      .update(webhooks)
      .set({ lastStatus: status, lastDeliveryAt: new Date(), failures: ok ? 0 : sql`${webhooks.failures} + 1`, active: ok ? true : sql`${webhooks.failures} + 1 < 20` })
      .where(eq(webhooks.id, id));
  },

  // ---- flags ----
  flags: () => db.select().from(featureFlags),
  async setFlag(key: string, v: { enabled: boolean; minTier?: string | null; rolloutPercent?: number; description?: string | null }) {
    const values = { ...v, updatedAt: new Date() };
    await db.insert(featureFlags).values({ key, ...values }).onConflictDoUpdate({ target: featureFlags.key, set: values });
  },

  // ---- jobs ----
  async jobOk(name: string, every: number | null) {
    await db.insert(jobRuns).values({ name, lastOkAt: new Date(), expectedEveryMinutes: every }).onConflictDoUpdate({ target: jobRuns.name, set: { lastOkAt: new Date(), ...(every ? { expectedEveryMinutes: every } : {}) } });
  },
  async jobFailed(name: string, error: string) {
    await db.insert(jobRuns).values({ name, lastErrorAt: new Date(), lastError: error.slice(0, 500) }).onConflictDoUpdate({ target: jobRuns.name, set: { lastErrorAt: new Date(), lastError: error.slice(0, 500) } });
  },
  async setExpected(name: string, every: number) {
    await db.insert(jobRuns).values({ name, expectedEveryMinutes: every }).onConflictDoUpdate({ target: jobRuns.name, set: { expectedEveryMinutes: every } });
  },
  jobs: () => db.select().from(jobRuns),

  // ---- admin ----
  async userByUuidOrName(q: string) {
    const [r] = await db
      .select({ accountId: accounts.id, uuid: accounts.playerUuid, username: players.username, createdAt: accounts.createdAt, bannedAt: accounts.bannedAt, modVersion: accounts.modVersion, modLastSeenAt: accounts.modLastSeenAt, tier: entitlements.tier, status: entitlements.status, currentPeriodEnd: entitlements.currentPeriodEnd })
      .from(accounts)
      .innerJoin(players, eq(players.uuid, accounts.playerUuid))
      .leftJoin(entitlements, eq(entitlements.accountId, accounts.id))
      .where(sql`${accounts.playerUuid} = ${q.toLowerCase().replace(/-/g, '')} or lower(${players.username}) = lower(${q})`)
      .limit(1);
    return r ?? null;
  },
  async ban(accountId: string, banned: boolean) {
    await db.update(accounts).set({ bannedAt: banned ? new Date() : null }).where(eq(accounts.id, accountId));
    if (banned) await db.delete(sessions).where(eq(sessions.accountId, accountId));
  },
  async modVersions() {
    return (await db.execute(sql`select mod_version as version, count(*)::int as accounts from accounts where mod_last_seen_at > now() - interval '30 days' group by 1 order by 2 desc`)) as unknown as { version: string | null; accounts: number }[];
  },
  async dataQuality() {
    const [r] = (await db.execute(sql`
      select
        (select count(*) from member_snapshots where coalesce(purse,0) < 0 or coalesce(personal_bank,0) < 0 or coalesce(profile_bank,0) < 0)::int as "negativeCoins",
        (select count(*) from (select player_uuid, profile_id, date_trunc('minute', taken_at) from member_snapshots group by 1,2,3 having count(*) > 1) d)::int as "duplicateSnapshots",
        (select extract(epoch from now() - max(polled_at))::int from bazaar_products) as "bazaarAgeSeconds",
        (select extract(epoch from now() - max(taken_at))::int from bazaar_snapshots) as "lastBazaarSnapshotSeconds",
        (select count(*) from member_snapshots where kind = 'reset' and taken_at > now() - interval '7 days')::int as "resetsThisWeek",
        (select count(*) from accounts where banned_at is not null)::int as "bannedAccounts"`)) as unknown as Record<string, number | null>[];
    return r ?? {};
  },
};
