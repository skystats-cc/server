import { asc, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { players, playerSnapshots } from '../../db/schema.js';

// Database queries only. No business logic, no HTTP.
export const playersRepo = {
  async findByUuid(uuid: string) {
    const [row] = await db.select().from(players).where(eq(players.uuid, uuid)).limit(1);
    return row ?? null;
  },

  async latestSnapshot(uuid: string) {
    const [row] = await db
      .select()
      .from(playerSnapshots)
      .where(eq(playerSnapshots.playerUuid, uuid))
      .orderBy(desc(playerSnapshots.takenAt))
      .limit(1);
    return row ?? null;
  },

  async snapshots(uuid: string, limit: number) {
    return db
      .select({ takenAt: playerSnapshots.takenAt, data: playerSnapshots.data })
      .from(playerSnapshots)
      .where(eq(playerSnapshots.playerUuid, uuid))
      .orderBy(desc(playerSnapshots.takenAt))
      .limit(limit);
  },

  async upsertWithSnapshot(p: { uuid: string; username: string; data: unknown }) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .insert(players)
        .values({ uuid: p.uuid, username: p.username, lastFetchedAt: now })
        .onConflictDoUpdate({
          target: players.uuid,
          set: { username: p.username, lastFetchedAt: now },
        });
      await tx.insert(playerSnapshots).values({ playerUuid: p.uuid, takenAt: now, data: p.data });
    });
  },

  async findStale(olderThan: Date, limit: number) {
    return db
      .select({ uuid: players.uuid })
      .from(players)
      .where(or(isNull(players.lastFetchedAt), lt(players.lastFetchedAt, olderThan)))
      .orderBy(asc(players.lastFetchedAt))
      .limit(limit);
  },
};
