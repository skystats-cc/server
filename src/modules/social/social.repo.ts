import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  accounts,
  achievements,
  competitionEntries,
  competitions,
  discordIdentities,
  follows,
  gamePlays,
  gameRounds,
  leaderboardEntries,
  memberDaily,
  modEvents,
  playSessions,
  players,
} from '../../db/schema.js';

export const socialRepo = {
  // ---- leaderboards ----
  /** Per (account, profile) gains over a window for opted-in players */
  async gains(fromDay: string) {
    return (await db.execute(sql`
      select a.id as "accountId", p.username as label, a.player_uuid as uuid, d.profile_id as "profileId", sp.game_mode as "gameMode", sp.cute_name as "profileName",
             sum(coalesce(d.close_total,0) - coalesce(d.open_total,0))::float as gain,
             count(*)::int as days, count(*) filter (where d.close_total > d.open_total)::int as "upDays"
      from member_daily d
      join accounts a on a.player_uuid = d.player_uuid and a.show_on_leaderboards
      join players p on p.uuid = a.player_uuid
      left join skyblock_profiles sp on sp.id = d.profile_id
      where d.day >= ${fromDay}
      group by 1,2,3,4,5,6`)) as unknown as { accountId: string; label: string | null; uuid: string; profileId: string; gameMode: string | null; profileName: string | null; gain: number; days: number; upDays: number }[];
  },
  async replaceBoards(rows: (typeof leaderboardEntries.$inferInsert)[]) {
    await db.transaction(async (tx) => {
      await tx.delete(leaderboardEntries);
      for (let i = 0; i < rows.length; i += 1000) await tx.insert(leaderboardEntries).values(rows.slice(i, i + 1000));
    });
  },
  board: (board: string, period: string, scope: string, limit = 100) =>
    db.select().from(leaderboardEntries).where(and(eq(leaderboardEntries.board, board), eq(leaderboardEntries.period, period), eq(leaderboardEntries.scope, scope))).orderBy(asc(leaderboardEntries.rank)).limit(limit),
  async boardFor(board: string, period: string, scope: string, subjects: string[]) {
    if (subjects.length === 0) return [];
    return db.select().from(leaderboardEntries).where(and(eq(leaderboardEntries.board, board), eq(leaderboardEntries.period, period), eq(leaderboardEntries.scope, scope), inArray(leaderboardEntries.subject, subjects))).orderBy(asc(leaderboardEntries.rank));
  },
  async accountsForDiscord(discordIds: string[]) {
    if (discordIds.length === 0) return [];
    return db.select({ accountId: discordIdentities.accountId, discordId: discordIdentities.discordId }).from(discordIdentities).where(inArray(discordIdentities.discordId, discordIds));
  },

  // ---- follows ----
  async publicAccountByName(name: string) {
    const [r] = await db
      .select({ id: accounts.id, uuid: accounts.playerUuid, username: players.username })
      .from(accounts)
      .innerJoin(players, eq(players.uuid, accounts.playerUuid))
      .where(and(sql`(lower(${players.username}) = lower(${name}) or lower(${accounts.vanity}) = lower(${name}))`, eq(accounts.profilePublic, true)))
      .limit(1);
    return r ?? null;
  },
  async follow(followerId: string, followedId: string) {
    await db.insert(follows).values({ followerId, followedId }).onConflictDoNothing();
  },
  async unfollow(followerId: string, followedId: string) {
    await db.delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followedId, followedId)));
  },
  async following(followerId: string) {
    return db
      .select({ id: accounts.id, uuid: accounts.playerUuid, username: players.username, since: follows.createdAt })
      .from(follows)
      .innerJoin(accounts, and(eq(accounts.id, follows.followedId), eq(accounts.profilePublic, true)))
      .innerJoin(players, eq(players.uuid, accounts.playerUuid))
      .where(eq(follows.followerId, followerId));
  },
  async countFollowing(followerId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, followerId));
    return r?.n ?? 0;
  },
  /** Achievements earned by public accounts you follow */
  async feed(followerId: string, since: Date) {
    return db
      .select({ uuid: accounts.playerUuid, username: players.username, key: achievements.key, earnedAt: achievements.earnedAt, showTierRole: accounts.showTierRole })
      .from(follows)
      .innerJoin(accounts, and(eq(accounts.id, follows.followedId), eq(accounts.profilePublic, true)))
      .innerJoin(players, eq(players.uuid, accounts.playerUuid))
      .innerJoin(achievements, eq(achievements.accountId, accounts.id))
      .where(and(eq(follows.followerId, followerId), gte(achievements.earnedAt, since)))
      .orderBy(desc(achievements.earnedAt))
      .limit(50);
  },

  // ---- achievements ----
  async achievementInputs() {
    return (await db.execute(sql`
      select a.id as "accountId", a.player_uuid as uuid, a.created_at as "createdAt",
             (select max(max_total) from member_daily d where d.player_uuid = a.player_uuid)::float as "maxTotal",
             (select count(*) from play_sessions s where s.account_id = a.id)::int as sessions,
             e.tier, e.status, e.current_period_end as "currentPeriodEnd", e.grace_until as "graceUntil"
      from accounts a left join entitlements e on e.account_id = a.id`)) as unknown as {
      accountId: string; uuid: string; createdAt: Date | string; maxTotal: number | null; sessions: number; tier: string | null; status: string | null; currentPeriodEnd: Date | string | null; graceUntil: Date | string | null;
    }[];
  },
  dailyChanges: (uuid: string) =>
    db.select({ day: memberDaily.day, change: sql<number>`sum(coalesce(${memberDaily.closeTotal},0) - coalesce(${memberDaily.openTotal},0))::float` }).from(memberDaily).where(eq(memberDaily.playerUuid, uuid)).groupBy(memberDaily.day).orderBy(asc(memberDaily.day)),
  async grant(accountId: string, keys: string[]) {
    if (keys.length === 0) return [];
    return db.insert(achievements).values(keys.map((key) => ({ accountId, key }))).onConflictDoNothing().returning();
  },
  achievementsOf: (accountId: string) => db.select().from(achievements).where(eq(achievements.accountId, accountId)).orderBy(asc(achievements.earnedAt)),

  // ---- wrapped ----
  async wrappedData(accountId: string, uuid: string, from: Date, to: Date) {
    const fromDay = from.toISOString().slice(0, 10);
    const toDay = new Date(to.getTime() - 1).toISOString().slice(0, 10);
    const days = await db
      .select({ day: memberDaily.day, change: sql<number>`sum(coalesce(${memberDaily.closeTotal},0) - coalesce(${memberDaily.openTotal},0))::float` })
      .from(memberDaily)
      .where(and(eq(memberDaily.playerUuid, uuid), gte(memberDaily.day, fromDay), sql`${memberDaily.day} <= ${toDay}`))
      .groupBy(memberDaily.day);
    const sessions = await db.select().from(playSessions).where(and(eq(playSessions.accountId, accountId), gte(playSessions.startedAt, from), lt(playSessions.startedAt, to)));
    const drops = await db
      .select({ name: modEvents.itemName, n: sql<number>`count(*)::int` })
      .from(modEvents)
      .where(and(eq(modEvents.accountId, accountId), gte(modEvents.at, from), lt(modEvents.at, to)))
      .groupBy(modEvents.itemName)
      .orderBy(desc(sql`count(*)`))
      .limit(3);
    const earned = await db.select().from(achievements).where(and(eq(achievements.accountId, accountId), gte(achievements.earnedAt, from), lt(achievements.earnedAt, to)));
    return { days, sessions, drops, earned };
  },

  // ---- competitions ----
  async createCompetition(v: typeof competitions.$inferInsert) {
    const [r] = await db.insert(competitions).values(v).returning();
    return r!;
  },
  activeCompetitions: (guildId: string) =>
    db.select().from(competitions).where(and(eq(competitions.guildId, guildId), gte(competitions.endsAt, new Date(Date.now() - 7 * 86_400_000)))).orderBy(desc(competitions.startsAt)),
  async competition(id: string) {
    const [r] = await db.select().from(competitions).where(eq(competitions.id, id)).limit(1);
    return r ?? null;
  },
  async join(competitionId: string, accountId: string) {
    await db.insert(competitionEntries).values({ competitionId, accountId }).onConflictDoNothing();
  },
  async standings(c: { id: string; startsAt: Date; endsAt: Date }) {
    return (await db.execute(sql`
      select p.username, a.player_uuid as uuid,
        (select coalesce(sum(t),0) from (
           select (array_agg(coalesce(s.purse,0)+coalesce(s.personal_bank,0)+coalesce(s.profile_bank,0) order by s.taken_at desc))[1]
                - (array_agg(coalesce(s.purse,0)+coalesce(s.personal_bank,0)+coalesce(s.profile_bank,0) order by s.taken_at asc))[1] as t
           from member_snapshots s
           where s.player_uuid = a.player_uuid and s.source = 'mod' and s.kind <> 'reset'
             and s.taken_at >= ${c.startsAt.toISOString()}::timestamptz and s.taken_at <= ${c.endsAt.toISOString()}::timestamptz
           group by s.profile_id) x)::float as gain
      from competition_entries ce
      join accounts a on a.id = ce.account_id
      join players p on p.uuid = a.player_uuid
      where ce.competition_id = ${c.id}
      order by gain desc`)) as unknown as { username: string | null; uuid: string; gain: number }[];
  },

  // ---- games ----
  async round(game: string, day: string) {
    const [r] = await db.select().from(gameRounds).where(and(eq(gameRounds.game, game), eq(gameRounds.day, day))).limit(1);
    return r ?? null;
  },
  async createRound(v: typeof gameRounds.$inferInsert) {
    await db.insert(gameRounds).values(v).onConflictDoNothing();
    return (await this.round(v.game, v.day))!;
  },
  async play(v: typeof gamePlays.$inferInsert) {
    const r = await db.insert(gamePlays).values(v).onConflictDoNothing().returning();
    return r.length > 0;
  },
  async unresolvedPredictions(before: string) {
    return db.select().from(gameRounds).where(and(eq(gameRounds.game, 'predict'), sql`${gameRounds.endPrice} is null`, lt(gameRounds.day, before)));
  },
  async resolveRound(day: string, endPrice: number) {
    await db.update(gameRounds).set({ endPrice }).where(and(eq(gameRounds.game, 'predict'), eq(gameRounds.day, day)));
  },
  playsFor: (game: string, day: string) => db.select().from(gamePlays).where(and(eq(gamePlays.game, game), eq(gamePlays.day, day))),
  async setPoints(game: string, day: string, discordId: string, points: number) {
    await db.update(gamePlays).set({ points }).where(and(eq(gamePlays.game, game), eq(gamePlays.day, day), eq(gamePlays.discordId, discordId)));
  },
  async gameBoard(game: string, since: string) {
    return db
      .select({ discordId: gamePlays.discordId, points: sql<number>`coalesce(sum(${gamePlays.points}),0)::int`, plays: sql<number>`count(*)::int` })
      .from(gamePlays)
      .where(and(eq(gamePlays.game, game), gte(gamePlays.day, since)))
      .groupBy(gamePlays.discordId)
      .orderBy(desc(sql`coalesce(sum(${gamePlays.points}),0)`))
      .limit(10);
  },
  async cleanupGames(before: string) {
    await db.delete(gamePlays).where(lt(gamePlays.day, before));
    await db.delete(gameRounds).where(lt(gameRounds.day, before));
  },
  /** Players who chose to show coins publicly, with their latest total */
  async richCandidates() {
    return (await db.execute(sql`
      select p.username, a.player_uuid as uuid,
        (select coalesce(s.purse,0)+coalesce(s.personal_bank,0)+coalesce(s.profile_bank,0) from member_snapshots s
          where s.player_uuid = a.player_uuid and s.source='mod' order by s.taken_at desc limit 1)::float as total
      from accounts a join players p on p.uuid = a.player_uuid
      where a.profile_public and not a.hide_bank and p.username is not null`)) as unknown as { username: string; uuid: string; total: number | null }[];
  },

  // ---- profile look ----
  async setLook(accountId: string, set: { profileTheme?: string | null; vanity?: string | null }) {
    await db.update(accounts).set(set).where(eq(accounts.id, accountId));
  },
  async look(accountId: string) {
    const [r] = await db.select({ profileTheme: accounts.profileTheme, vanity: accounts.vanity }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return r ?? null;
  },
  async vanityTaken(vanity: string, accountId: string) {
    const [r] = await db.select({ id: accounts.id }).from(accounts).innerJoin(players, eq(players.uuid, accounts.playerUuid)).where(sql`(lower(${accounts.vanity}) = lower(${vanity}) or lower(${players.username}) = lower(${vanity})) and ${accounts.id} <> ${accountId}`).limit(1);
    return Boolean(r);
  },
};

