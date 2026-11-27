import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { accounts, authChallenges, pairings, players, sessions } from '../../db/schema.js';

const accountView = {
  id: accounts.id,
  uuid: accounts.playerUuid,
  username: players.username,
  trackingEnabled: accounts.trackingEnabled,
  modLastSeenAt: accounts.modLastSeenAt,
  modVersion: accounts.modVersion,
  createdAt: accounts.createdAt,
};

export type AccountRow = {
  id: string;
  uuid: string;
  username: string | null;
  trackingEnabled: boolean;
  modLastSeenAt: Date | null;
  modVersion: string | null;
  createdAt: Date;
};

export const accountsRepo = {
  /** Insert the player or update their username (we just learned it from Mojang) */
  async upsertPlayer(uuid: string, username: string) {
    await db
      .insert(players)
      .values({ uuid, username, usernameCheckedAt: new Date() })
      .onConflictDoUpdate({
        target: players.uuid,
        set: { username, usernameCheckedAt: new Date() },
      });
  },

  /** Returns the account id and whether it was just created */
  async ensureAccount(playerUuid: string): Promise<{ id: string; created: boolean }> {
    const inserted = await db
      .insert(accounts)
      .values({ playerUuid, lastLoginAt: new Date() })
      .onConflictDoNothing({ target: accounts.playerUuid })
      .returning({ id: accounts.id });
    if (inserted[0]) return { id: inserted[0].id, created: true };
    const [row] = await db
      .update(accounts)
      .set({ lastLoginAt: new Date() })
      .where(eq(accounts.playerUuid, playerUuid))
      .returning({ id: accounts.id });
    return { id: row!.id, created: false };
  },

  async getAccount(accountId: string): Promise<AccountRow | null> {
    const [row] = await db
      .select(accountView)
      .from(accounts)
      .innerJoin(players, eq(players.uuid, accounts.playerUuid))
      .where(eq(accounts.id, accountId))
      .limit(1);
    return row ?? null;
  },

  async updateSettings(accountId: string, settings: { trackingEnabled?: boolean }) {
    if (settings.trackingEnabled === undefined) return;
    await db.update(accounts).set({ trackingEnabled: settings.trackingEnabled }).where(eq(accounts.id, accountId));
  },

  async recordHeartbeat(accountId: string, modVersion: string) {
    await db
      .update(accounts)
      .set({ modLastSeenAt: new Date(), modVersion })
      .where(eq(accounts.id, accountId));
  },

  // ---- sessions ----

  async createSession(s: { accountId: string; kind: 'mod' | 'web'; tokenHash: string; expiresAt: Date; userAgent?: string }) {
    await db.insert(sessions).values({ ...s, userAgent: s.userAgent?.slice(0, 200) });
  },

  async findSession(tokenHash: string) {
    const [row] = await db
      .select({
        sessionId: sessions.id,
        accountId: sessions.accountId,
        kind: sessions.kind,
        lastUsedAt: sessions.lastUsedAt,
        playerUuid: accounts.playerUuid,
      })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  },

  async touchSession(sessionId: string) {
    await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, sessionId));
  },

  async listSessions(accountId: string) {
    return db
      .select({ id: sessions.id, kind: sessions.kind, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.accountId, accountId), gt(sessions.expiresAt, new Date())));
  },

  async deleteOwnSession(accountId: string, sessionId: string) {
    const rows = await db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  },

  async deleteOtherSessions(accountId: string, keepSessionId: string) {
    const rows = await db
      .delete(sessions)
      .where(and(eq(sessions.accountId, accountId), ne(sessions.id, keepSessionId)))
      .returning({ id: sessions.id });
    return rows.length;
  },

  async deleteSession(sessionId: string) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  },

  /** Remove expired sessions, challenges and pairings */
  async cleanup() {
    const now = new Date();
    const dayAgo = new Date(Date.now() - 86_400_000);
    const s = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
    await db.delete(authChallenges).where(lt(authChallenges.expiresAt, now));
    const p = await db.delete(pairings).where(lt(pairings.expiresAt, dayAgo)).returning({ id: pairings.id });
    return { sessions: s.length, pairings: p.length };
  },

};
