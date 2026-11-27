import { and, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, memberSnapshots, players, profileMembers, skyblockProfiles } from '../../db/schema.js';
import type { ParsedProfile } from './skyblock.parse.js';

export const skyblockRepo = {
  async getPlayer(uuid: string) {
    const [row] = await db.select().from(players).where(eq(players.uuid, uuid)).limit(1);
    return row ?? null;
  },

  /** Members whose SkyStats account has tracking turned off */
  async trackingDisabled(uuids: string[]) {
    if (uuids.length === 0) return new Set<string>();
    const rows = await db
      .select({ uuid: accounts.playerUuid })
      .from(accounts)
      .where(and(inArray(accounts.playerUuid, uuids), eq(accounts.trackingEnabled, false)));
    return new Set(rows.map((r) => r.uuid));
  },

  /** Store everything one /skyblock/profiles call told us about `requester` and their co-ops */
  async saveProfiles(requester: string, profiles: ParsedProfile[]) {
    const now = new Date();
    await db.transaction(async (tx) => {
      const memberUuids = [...new Set([requester, ...profiles.flatMap((p) => p.members.map((m) => m.uuid))])];
      await tx
        .insert(players)
        .values(memberUuids.map((uuid) => ({ uuid })))
        .onConflictDoNothing({ target: players.uuid });

      for (const p of profiles) {
        await tx
          .insert(skyblockProfiles)
          .values({ id: p.id, cuteName: p.cuteName, gameMode: p.gameMode, bankBalance: p.bankBalance, updatedAt: now })
          .onConflictDoUpdate({
            target: skyblockProfiles.id,
            set: { cuteName: p.cuteName, gameMode: p.gameMode, bankBalance: p.bankBalance, updatedAt: now },
          });

        for (const m of p.members) {
          const values = {
            active: m.active,
            firstJoin: m.firstJoin,
            purse: m.purse,
            personalBank: m.personalBank,
            skyblockXp: m.skyblockXp,
            updatedAt: now,
          };
          // `selected` is only meaningful for the player we asked about
          const selected = m.uuid === requester ? { selected: p.selected } : {};
          await tx
            .insert(profileMembers)
            .values({ profileId: p.id, playerUuid: m.uuid, ...values, ...selected })
            .onConflictDoUpdate({
              target: [profileMembers.profileId, profileMembers.playerUuid],
              set: { ...values, ...selected },
            });
        }
      }

      // Profiles the requester is no longer in (deleted / left / kicked)
      const ids = profiles.map((p) => p.id);
      await tx
        .update(profileMembers)
        .set({ active: false, selected: false, updatedAt: now })
        .where(
          and(
            eq(profileMembers.playerUuid, requester),
            ids.length ? notInArray(profileMembers.profileId, ids) : sql`true`,
          ),
        );

      await tx.update(players).set({ profilesFetchedAt: now }).where(eq(players.uuid, requester));
    });
  },

  /** Append a money snapshot unless one was taken for this member in the last `minMinutes` */
  async snapshotIfDue(
    s: { profileId: string; playerUuid: string; purse: number | null; personalBank: number | null; profileBank: number | null; skyblockXp: number | null },
    minMinutes: number,
  ) {
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
    await db.insert(memberSnapshots).values(s);
    return true;
  },

  /** The requester's active profiles + every active member, with SkyStats/mod info */
  async myProfiles(uuid: string) {
    const mine = await db
      .select({
        id: skyblockProfiles.id,
        cuteName: skyblockProfiles.cuteName,
        gameMode: skyblockProfiles.gameMode,
        bankBalance: skyblockProfiles.bankBalance,
        updatedAt: skyblockProfiles.updatedAt,
        selected: profileMembers.selected,
      })
      .from(profileMembers)
      .innerJoin(skyblockProfiles, eq(skyblockProfiles.id, profileMembers.profileId))
      .where(and(eq(profileMembers.playerUuid, uuid), eq(profileMembers.active, true)));

    if (mine.length === 0) return { profiles: mine, members: [] };

    const members = await db
      .select({
        profileId: profileMembers.profileId,
        uuid: profileMembers.playerUuid,
        username: players.username,
        firstJoin: profileMembers.firstJoin,
        purse: profileMembers.purse,
        personalBank: profileMembers.personalBank,
        skyblockXp: profileMembers.skyblockXp,
        accountId: accounts.id,
        trackingEnabled: accounts.trackingEnabled,
        modLastSeenAt: accounts.modLastSeenAt,
      })
      .from(profileMembers)
      .innerJoin(players, eq(players.uuid, profileMembers.playerUuid))
      .leftJoin(accounts, eq(accounts.playerUuid, profileMembers.playerUuid))
      .where(
        and(
          inArray(
            profileMembers.profileId,
            mine.map((p) => p.id),
          ),
          eq(profileMembers.active, true),
        ),
      );
    return { profiles: mine, members };
  },

  /** Players whose username is unknown or older than `staleBefore` */
  async needingNames(uuids: string[], staleBefore: Date) {
    if (uuids.length === 0) return [];
    const rows = await db
      .select({ uuid: players.uuid })
      .from(players)
      .where(
        and(
          inArray(players.uuid, uuids),
          or(isNull(players.username), isNull(players.usernameCheckedAt), lt(players.usernameCheckedAt, staleBefore)),
        ),
      );
    return rows.map((r) => r.uuid);
  },

  async setUsername(uuid: string, username: string | null) {
    await db
      .update(players)
      .set({ ...(username ? { username } : {}), usernameCheckedAt: new Date() })
      .where(eq(players.uuid, uuid));
  },
};
