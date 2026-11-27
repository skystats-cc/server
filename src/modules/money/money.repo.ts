import { and, asc, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, entitlements, memberDaily, memberSnapshots, profileMembers } from '../../db/schema.js';

export interface SnapshotInput {
  profileId: string;
  playerUuid: string;
  purse: number | null;
  personalBank: number | null;
  profileBank: number | null;
  skyblockXp: number | null;
}

const total = sql<number>`coalesce(${memberSnapshots.purse}, 0) + coalesce(${memberSnapshots.personalBank}, 0) + coalesce(${memberSnapshots.profileBank}, 0)`;

export const moneyRepo = {
  /** Is this player an active member of this profile (as far as we know)? */
  async isMember(playerUuid: string, profileId: string) {
    const [row] = await db
      .select({ active: profileMembers.active })
      .from(profileMembers)
      .where(and(eq(profileMembers.playerUuid, playerUuid), eq(profileMembers.profileId, profileId)))
      .limit(1);
    return row?.active === true;
  },

  /** Append a mod-reported snapshot unless one exists for this member within `minMinutes`. Idempotent. */
  async snapshotIfDue(s: SnapshotInput, minMinutes: number) {
    const since = new Date(Date.now() - minMinutes * 60_000);
    const [recent] = await db
      .select({ id: memberSnapshots.id })
      .from(memberSnapshots)
      .where(
        and(
          eq(memberSnapshots.playerUuid, s.playerUuid),
          eq(memberSnapshots.profileId, s.profileId),
          gt(memberSnapshots.takenAt, since),
        ),
      )
      .limit(1);
    if (recent) return false;
    await db.insert(memberSnapshots).values({ ...s, source: 'mod' });
    return true;
  },

  /** Raw mod-reported points since `from` (null = all) */
  async points(playerUuid: string, profileId: string, from: Date | null) {
    return db
      .select({
        t: memberSnapshots.takenAt,
        purse: memberSnapshots.purse,
        personalBank: memberSnapshots.personalBank,
        profileBank: memberSnapshots.profileBank,
        total,
      })
      .from(memberSnapshots)
      .where(
        and(
          eq(memberSnapshots.playerUuid, playerUuid),
          eq(memberSnapshots.profileId, profileId),
          eq(memberSnapshots.source, 'mod'),
          from ? gte(memberSnapshots.takenAt, from) : sql`true`,
        ),
      )
      .orderBy(asc(memberSnapshots.takenAt))
      .limit(5000);
  },

  async daily(playerUuid: string, profileId: string, fromDay: string | null) {
    return db
      .select()
      .from(memberDaily)
      .where(
        and(
          eq(memberDaily.playerUuid, playerUuid),
          eq(memberDaily.profileId, profileId),
          fromDay ? gte(memberDaily.day, fromDay) : sql`true`,
        ),
      )
      .orderBy(asc(memberDaily.day));
  },

  /** Rebuild daily rollups for every day touched since `since`. Safe to re-run. */
  async rollupSince(since: Date) {
    const res = await db.execute(sql`
      insert into member_daily (player_uuid, profile_id, day, open_total, close_total, min_total, max_total, samples)
      select player_uuid, profile_id, (taken_at at time zone 'UTC')::date as day,
             (array_agg(t order by taken_at asc))[1],
             (array_agg(t order by taken_at desc))[1],
             min(t), max(t), count(*)::int
      from (
        select player_uuid, profile_id, taken_at,
               coalesce(purse, 0) + coalesce(personal_bank, 0) + coalesce(profile_bank, 0) as t
        from member_snapshots
        where source = 'mod' and taken_at >= date_trunc('day', ${since.toISOString()}::timestamptz)
      ) s
      group by player_uuid, profile_id, day
      on conflict (player_uuid, profile_id, day) do update set
        open_total = excluded.open_total, close_total = excluded.close_total,
        min_total = excluded.min_total, max_total = excluded.max_total, samples = excluded.samples
    `);
    return res.count ?? 0;
  },

  /** Accounts with their billing state, for the retention job */
  async accountsWithEntitlements() {
    return db
      .select({
        accountId: accounts.id,
        playerUuid: accounts.playerUuid,
        tier: entitlements.tier,
        status: entitlements.status,
        currentPeriodEnd: entitlements.currentPeriodEnd,
        graceUntil: entitlements.graceUntil,
        downgradedAt: entitlements.downgradedAt,
      })
      .from(accounts)
      .leftJoin(entitlements, eq(entitlements.accountId, accounts.id));
  },

  /** Retention + erasure are the only exceptions to "snapshots are append-only". */
  async deleteHistoryBefore(playerUuid: string, before: Date) {
    const snaps = await db
      .delete(memberSnapshots)
      .where(and(eq(memberSnapshots.playerUuid, playerUuid), lt(memberSnapshots.takenAt, before)))
      .returning({ id: memberSnapshots.id });
    const day = before.toISOString().slice(0, 10);
    await db.delete(memberDaily).where(and(eq(memberDaily.playerUuid, playerUuid), lt(memberDaily.day, day)));
    return snaps.length;
  },

  /** History for players who have no SkyStats account (e.g. after erasure or old API polling) */
  async deleteOrphanHistory() {
    const r = await db
      .delete(memberSnapshots)
      .where(sql`${memberSnapshots.playerUuid} not in (select player_uuid from accounts)`)
      .returning({ id: memberSnapshots.id });
    await db.delete(memberDaily).where(sql`${memberDaily.playerUuid} not in (select player_uuid from accounts)`);
    return r.length;
  },
};
