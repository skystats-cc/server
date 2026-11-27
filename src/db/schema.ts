import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// Shared price/volume columns for latest + snapshot tables
const bazaarFields = () => ({
  buyPrice: doublePrecision('buy_price').notNull(),
  sellPrice: doublePrecision('sell_price').notNull(),
  buyVolume: bigint('buy_volume', { mode: 'number' }).notNull(),
  sellVolume: bigint('sell_volume', { mode: 'number' }).notNull(),
  buyMovingWeek: bigint('buy_moving_week', { mode: 'number' }).notNull(),
  sellMovingWeek: bigint('sell_moving_week', { mode: 'number' }).notNull(),
  buyOrders: integer('buy_orders').notNull(),
  sellOrders: integer('sell_orders').notNull(),
});

// Latest state of every bazaar product. Overwritten every poll (~30s) for the realtime view.
export const bazaarProducts = pgTable('bazaar_products', {
  productId: text('product_id').primaryKey(),
  ...bazaarFields(),
  upstreamUpdatedAt: ts('upstream_updated_at').notNull(),
  polledAt: ts('polled_at').notNull(),
});

// Append-only history. One row per product per snapshot (every 2h by default).
export const bazaarSnapshots = pgTable(
  'bazaar_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => bazaarProducts.productId),
    takenAt: ts('taken_at').notNull().defaultNow(),
    ...bazaarFields(),
  },
  (t) => [
    index('bazaar_snapshots_product_taken_idx').on(t.productId, t.takenAt),
    index('bazaar_snapshots_taken_idx').on(t.takenAt), // for retention cleanup
  ],
);

// Single-row cache of status.hypixel.net (id = 'current').
export const hypixelStatus = pgTable('hypixel_status', {
  id: text('id').primaryKey(),
  indicator: text('indicator').notNull(),
  description: text('description').notNull(),
  components: jsonb('components').notNull(),
  incidents: jsonb('incidents').notNull(),
  checkedAt: ts('checked_at').notNull(),
});

// ---------------------------------------------------------------------------
// Players, accounts, sessions
// ---------------------------------------------------------------------------

// Every Minecraft player we know about: SkyStats users and their co-op members.
// uuid = Minecraft UUID without dashes, lowercase.
export const players = pgTable('players', {
  uuid: text('uuid').primaryKey(),
  username: text('username'),
  usernameCheckedAt: ts('username_checked_at'),
  profilesFetchedAt: ts('profiles_fetched_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// A SkyStats user = a Minecraft account that proved ownership through the mod.
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerUuid: text('player_uuid')
    .notNull()
    .unique()
    .references(() => players.uuid),
  trackingEnabled: boolean('tracking_enabled').notNull().default(true),
  modLastSeenAt: ts('mod_last_seen_at'),
  modVersion: text('mod_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastLoginAt: ts('last_login_at'),
});

// Bearer tokens (mod) and cookies (web). Only the SHA-256 of the token is stored.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'mod' | 'web'
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [index('sessions_account_idx').on(t.accountId)],
);

// One-time serverIds for Mojang hasJoined verification
export const authChallenges = pgTable('auth_challenges', {
  serverId: text('server_id').primaryKey(),
  expiresAt: ts('expires_at').notNull(),
});

// Website shows `code`; the mod claims it; the browser (holding the secret) gets a session.
export const pairings = pgTable('pairings', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  status: text('status').notNull().default('pending'), // pending | linked | consumed
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  linkedAt: ts('linked_at'),
});

// ---------------------------------------------------------------------------
// SkyBlock profiles & co-ops (from the Hypixel API)
// ---------------------------------------------------------------------------

export const skyblockProfiles = pgTable('skyblock_profiles', {
  id: text('id').primaryKey(), // Hypixel profile_id, no dashes
  cuteName: text('cute_name'),
  gameMode: text('game_mode').notNull().default('normal'),
  bankBalance: doublePrecision('bank_balance'), // null when the member has the banking API off
  updatedAt: ts('updated_at').notNull(),
});

// Profile membership = the co-op "group". Members who left or haven't accepted are active=false.
export const profileMembers = pgTable(
  'profile_members',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => skyblockProfiles.id, { onDelete: 'cascade' }),
    playerUuid: text('player_uuid')
      .notNull()
      .references(() => players.uuid),
    active: boolean('active').notNull(),
    selected: boolean('selected').notNull().default(false), // this player's selected profile
    firstJoin: ts('first_join'),
    purse: doublePrecision('purse'),
    personalBank: doublePrecision('personal_bank'),
    skyblockXp: doublePrecision('skyblock_xp'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.playerUuid] }),
    index('profile_members_player_idx').on(t.playerUuid),
  ],
);

// Money history per member (append-only, at most one per MEMBER_SNAPSHOT_MIN_MINUTES).
export const memberSnapshots = pgTable(
  'member_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    profileId: text('profile_id').notNull(),
    playerUuid: text('player_uuid').notNull(),
    takenAt: ts('taken_at').notNull().defaultNow(),
    purse: doublePrecision('purse'),
    personalBank: doublePrecision('personal_bank'),
    profileBank: doublePrecision('profile_bank'),
    skyblockXp: doublePrecision('skyblock_xp'),
  },
  (t) => [
    index('member_snapshots_member_taken_idx').on(t.playerUuid, t.profileId, t.takenAt),
    index('member_snapshots_taken_idx').on(t.takenAt),
  ],
);
