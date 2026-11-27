import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  uuid: text('uuid').primaryKey(),
  username: text('username').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
});

// Append-only: never update or delete snapshot rows.
export const playerSnapshots = pgTable(
  'player_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerUuid: text('player_uuid')
      .notNull()
      .references(() => players.uuid),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('player_snapshots_player_taken_idx').on(t.playerUuid, t.takenAt)],
);
