import { and, eq, gt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { authChallenges } from '../../db/schema.js';

export const authRepo = {
  async createChallenge(serverId: string, expiresAt: Date) {
    await db.insert(authChallenges).values({ serverId, expiresAt });
  },

  /** One-time use: deletes the challenge and returns true if it existed and hadn't expired */
  async consumeChallenge(serverId: string): Promise<boolean> {
    const rows = await db
      .delete(authChallenges)
      .where(and(eq(authChallenges.serverId, serverId), gt(authChallenges.expiresAt, new Date())))
      .returning({ serverId: authChallenges.serverId });
    return rows.length > 0;
  },
};
