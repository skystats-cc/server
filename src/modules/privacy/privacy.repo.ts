import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  accounts,
  alertRules,
  annotations,
  auditLog,
  modEvents,
  playSessions,
  customMethods,
  methodVotes,
  watchlist,
  discordIdentities,
  moneyGoals,
  notificationPrefs,
  notifications,
  entitlements,
  memberDaily,
  memberSnapshots,
  pairings,
  players,
  profileMembers,
  sessions,
  skyblockProfiles,
} from '../../db/schema.js';

export const PRIVACY_FIELDS = ['trackingEnabled', 'profilePublic', 'showOnLeaderboards', 'allowActivityPings', 'hideBank', 'discordPublic', 'showTierRole', 'activityInsights'] as const;
export type PrivacySettings = Record<(typeof PRIVACY_FIELDS)[number], boolean>;

export const privacyRepo = {
  async get(accountId: string): Promise<PrivacySettings | null> {
    const [row] = await db
      .select({
        trackingEnabled: accounts.trackingEnabled,
        profilePublic: accounts.profilePublic,
        showOnLeaderboards: accounts.showOnLeaderboards,
        allowActivityPings: accounts.allowActivityPings,
        hideBank: accounts.hideBank,
        discordPublic: accounts.discordPublic,
        showTierRole: accounts.showTierRole,
        activityInsights: accounts.activityInsights,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    return row ?? null;
  },

  async update(accountId: string, set: Partial<PrivacySettings>) {
    if (Object.keys(set).length) await db.update(accounts).set(set).where(eq(accounts.id, accountId));
  },

  /** Everything we hold about one account (UK GDPR Article 15 / 20). */
  async exportAll(accountId: string) {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!account) return null;
    const uuid = account.playerUuid;
    const [player] = await db.select().from(players).where(eq(players.uuid, uuid)).limit(1);
    const memberships = await db.select().from(profileMembers).where(eq(profileMembers.playerUuid, uuid));
    const profileIds = memberships.map((m) => m.profileId);
    const profiles = profileIds.length
      ? await db.select().from(skyblockProfiles).where(inArray(skyblockProfiles.id, profileIds))
      : [];
    const sess = await db
      .select({ kind: sessions.kind, userAgent: sessions.userAgent, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, lastUsedAt: sessions.lastUsedAt })
      .from(sessions)
      .where(eq(sessions.accountId, accountId));
    const [entitlement] = await db.select().from(entitlements).where(eq(entitlements.accountId, accountId));
    return {
      account,
      player,
      profiles,
      memberships,
      moneySnapshots: await db.select().from(memberSnapshots).where(eq(memberSnapshots.playerUuid, uuid)),
      moneyDaily: await db.select().from(memberDaily).where(eq(memberDaily.playerUuid, uuid)),
      sessions: sess, // token hashes are left out on purpose
      entitlement: entitlement ?? null,
      notificationPrefs: (await db.select().from(notificationPrefs).where(eq(notificationPrefs.accountId, accountId)))[0] ?? null,
      alerts: await db.select().from(alertRules).where(eq(alertRules.accountId, accountId)),
      playSessions: await db.select().from(playSessions).where(eq(playSessions.accountId, accountId)),
      modEvents: await db.select().from(modEvents).where(eq(modEvents.accountId, accountId)),
      annotations: await db.select().from(annotations).where(eq(annotations.accountId, accountId)),
      watchlist: await db.select().from(watchlist).where(eq(watchlist.accountId, accountId)),
      customMethods: await db.select().from(customMethods).where(eq(customMethods.accountId, accountId)),
      methodVotes: await db.select().from(methodVotes).where(eq(methodVotes.accountId, accountId)),
      goals: await db.select().from(moneyGoals).where(eq(moneyGoals.accountId, accountId)),
      notifications: await db.select().from(notifications).where(eq(notifications.accountId, accountId)),
      discord: (await db.select().from(discordIdentities).where(eq(discordIdentities.accountId, accountId)))[0] ?? null,
      auditLog: await db.select().from(auditLog).where(eq(auditLog.accountId, accountId)),
    };
  },

  /**
   * UK GDPR Article 17 erasure. Removes the account (sessions, pairings and entitlement cascade),
   * money history and stored co-op rows. Stripe keeps invoices it must hold for tax.
   */
  async erase(accountId: string) {
    return db.transaction(async (tx) => {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!account) return null;
      const uuid = account.playerUuid;
      await tx.delete(memberSnapshots).where(eq(memberSnapshots.playerUuid, uuid));
      await tx.delete(memberDaily).where(eq(memberDaily.playerUuid, uuid));
      await tx.delete(profileMembers).where(eq(profileMembers.playerUuid, uuid));
      await tx.delete(sessions).where(eq(sessions.accountId, accountId));
      await tx.delete(pairings).where(eq(pairings.accountId, accountId));
      await tx.delete(accounts).where(eq(accounts.id, accountId));
      await tx.update(players).set({ username: null, profilesFetchedAt: null }).where(eq(players.uuid, uuid));
      return { uuid };
    });
  },
};
