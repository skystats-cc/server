import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, discordIdentities, entitlements, oauthStates, players } from '../../db/schema.js';

export const discordRepo = {
  async forAccount(accountId: string) {
    const [row] = await db.select().from(discordIdentities).where(eq(discordIdentities.accountId, accountId)).limit(1);
    return row ?? null;
  },

  /** Every Minecraft account this Discord user has linked, most recently used first */
  async accountsFor(discordId: string) {
    return db
      .select({
        accountId: accounts.id,
        uuid: accounts.playerUuid,
        username: players.username,
        lastLoginAt: accounts.lastLoginAt,
        discordPublic: accounts.discordPublic,
        profilePublic: accounts.profilePublic,
      })
      .from(discordIdentities)
      .innerJoin(accounts, eq(accounts.id, discordIdentities.accountId))
      .innerJoin(players, eq(players.uuid, accounts.playerUuid))
      .where(eq(discordIdentities.discordId, discordId))
      .orderBy(desc(accounts.lastLoginAt));
  },

  async link(accountId: string, discordId: string, discordUsername: string | null) {
    await db
      .insert(discordIdentities)
      .values({ accountId, discordId, discordUsername })
      .onConflictDoUpdate({ target: discordIdentities.accountId, set: { discordId, discordUsername, linkedAt: new Date() } });
  },

  async unlink(accountId: string) {
    const rows = await db.delete(discordIdentities).where(eq(discordIdentities.accountId, accountId)).returning();
    return rows.length > 0;
  },

  async touchLogin(accountId: string) {
    await db.update(accounts).set({ lastLoginAt: new Date() }).where(eq(accounts.id, accountId));
  },

  // ---- OAuth state ----
  async saveState(stateHash: string, mode: 'login' | 'link', accountId: string | null, expiresAt: Date) {
    await db.insert(oauthStates).values({ stateHash, mode, accountId, expiresAt });
  },

  /** Single use: deletes the state and returns it if it was still valid */
  async takeState(stateHash: string) {
    const [row] = await db
      .delete(oauthStates)
      .where(and(eq(oauthStates.stateHash, stateHash), gt(oauthStates.expiresAt, new Date())))
      .returning();
    return row ?? null;
  },

  async cleanupStates() {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  },

  /** Role sync: every linked Discord user with their best tier and opt-ins */
  async roleSyncRows() {
    return db
      .select({
        discordId: discordIdentities.discordId,
        discordPublic: accounts.discordPublic,
        showTierRole: accounts.showTierRole,
        tier: entitlements.tier,
        status: entitlements.status,
        currentPeriodEnd: entitlements.currentPeriodEnd,
        graceUntil: entitlements.graceUntil,
      })
      .from(discordIdentities)
      .innerJoin(accounts, eq(accounts.id, discordIdentities.accountId))
      .leftJoin(entitlements, eq(entitlements.accountId, accounts.id));
  },

  async entitlementsOf(accountIds: string[]) {
    if (accountIds.length === 0) return [];
    return db.select().from(entitlements).where(inArray(entitlements.accountId, accountIds));
  },
};
