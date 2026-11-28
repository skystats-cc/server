import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, memberDaily, memberSnapshots, players, profileMembers, skyblockProfiles } from '../../db/schema.js';

export const playersRepo = {
  /** Only players with an account that turned on a public profile */
  async publicByName(name: string) {
    const [row] = await db
      .select({
        uuid: players.uuid,
        username: players.username,
        hideBank: accounts.hideBank,
        trackingEnabled: accounts.trackingEnabled,
        modLastSeenAt: accounts.modLastSeenAt,
        accountId: accounts.id,
        profileTheme: accounts.profileTheme,
        vanity: accounts.vanity,
        showTierRole: accounts.showTierRole,
      })
      .from(players)
      .innerJoin(accounts, eq(accounts.playerUuid, players.uuid))
      .where(and(sql`(lower(${players.username}) = lower(${name}) or lower(${accounts.vanity}) = lower(${name}))`, eq(accounts.profilePublic, true)))
      .limit(1);
    return row ?? null;
  },

  async profiles(uuid: string) {
    return db
      .select({
        id: skyblockProfiles.id,
        name: skyblockProfiles.cuteName,
        gameMode: skyblockProfiles.gameMode,
        selected: profileMembers.selected,
        skyblockXp: profileMembers.skyblockXp,
      })
      .from(profileMembers)
      .innerJoin(skyblockProfiles, eq(skyblockProfiles.id, profileMembers.profileId))
      .where(and(eq(profileMembers.playerUuid, uuid), eq(profileMembers.active, true)));
  },

  async latestTotal(uuid: string, profileId: string) {
    const [row] = await db
      .select({
        total: sql<number>`coalesce(${memberSnapshots.purse},0)+coalesce(${memberSnapshots.personalBank},0)+coalesce(${memberSnapshots.profileBank},0)`,
      })
      .from(memberSnapshots)
      .where(and(eq(memberSnapshots.playerUuid, uuid), eq(memberSnapshots.profileId, profileId), eq(memberSnapshots.source, 'mod')))
      .orderBy(desc(memberSnapshots.takenAt))
      .limit(1);
    return row ? Number(row.total) : null;
  },

  async week(uuid: string, profileId: string, fromDay: string) {
    return db
      .select({ day: memberDaily.day, total: memberDaily.closeTotal })
      .from(memberDaily)
      .where(and(eq(memberDaily.playerUuid, uuid), eq(memberDaily.profileId, profileId), gte(memberDaily.day, fromDay)))
      .orderBy(memberDaily.day);
  },
};
