import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
  // Top of the order book (from buy_summary / sell_summary), latest only
  buySummary: jsonb('buy_summary').notNull().default([]),
  sellSummary: jsonb('sell_summary').notNull().default([]),
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
  // Privacy (ICO Children's Code: high privacy by default, everything social is opt-in)
  profilePublic: boolean('profile_public').notNull().default(false),
  showOnLeaderboards: boolean('show_on_leaderboards').notNull().default(false),
  allowActivityPings: boolean('allow_activity_pings').notNull().default(false),
  hideBank: boolean('hide_bank').notNull().default(true),
  discordPublic: boolean('discord_public').notNull().default(false), // /whois and the "linked" role
  showTierRole: boolean('show_tier_role').notNull().default(false), // Pro/Max role in the SkyStats server
  activityInsights: boolean('activity_insights').notNull().default(false), // profiling: off by default (Children's Code)
  // Public profile look (Pro: theme; Max: vanity link). Preset ids only, no uploads.
  bannedAt: ts('banned_at'), // set by an admin; signs the account out everywhere
  profileTheme: text('profile_theme'),
  vanity: text('vanity').unique(),
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
  // Set when the pairing was started from Discord (/link): claiming it also links this Discord user
  discordId: text('discord_id'),
  discordUsername: text('discord_username'),
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
    // Where the numbers came from. Only 'mod' (the player's own client) is written now:
    // Hypixel's API policy forbids building stat histories by polling the Public API.
    source: text('source').notNull().default('mod'),
    // Value of the player's inventory at bazaar/BIN prices when the mod sent it (only the total is kept)
    inventoryValue: doublePrecision('inventory_value'),
    kind: text('kind').notNull().default('normal'), // normal | transfer | reset
  },
  (t) => [
    index('member_snapshots_member_taken_idx').on(t.playerUuid, t.profileId, t.takenAt),
    index('member_snapshots_taken_idx').on(t.takenAt),
  ],
);

// ---------------------------------------------------------------------------
// Rollups, billing, compliance
// ---------------------------------------------------------------------------

// One row per member per UTC day, rebuilt from member_snapshots by the rollup job.
// Long chart ranges read this instead of raw snapshots.
export const memberDaily = pgTable(
  'member_daily',
  {
    playerUuid: text('player_uuid').notNull(),
    profileId: text('profile_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    openTotal: doublePrecision('open_total'),
    closeTotal: doublePrecision('close_total'),
    minTotal: doublePrecision('min_total'),
    maxTotal: doublePrecision('max_total'),
    samples: integer('samples').notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerUuid, t.profileId, t.day] })],
);

// What each account has paid for. Every service reads tiers from here (never from Stripe directly).
export const entitlements = pgTable('entitlements', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('free'), // free | pro | max
  status: text('status').notNull().default('none'), // none | trialing | active | past_due | canceled
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  currentPeriodEnd: ts('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  graceUntil: ts('grace_until'), // paid features stay on until here after a failed payment
  downgradedAt: ts('downgraded_at'), // starts the 30-day soft-retention window
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// Stripe sends webhooks at least once; this makes handling idempotent.
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

// Append-only record of privacy, billing and admin actions (UK GDPR accountability).
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: ts('at').notNull().defaultNow(),
    actor: text('actor').notNull(), // 'user' | 'admin' | 'system' | 'stripe'
    action: text('action').notNull(),
    accountId: uuid('account_id'), // kept (not FK) so the log survives account deletion
    details: jsonb('details').notNull().default({}),
  },
  (t) => [index('audit_log_account_idx').on(t.accountId, t.at)],
);

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

// A Minecraft account's Discord login. One Discord user may own several Minecraft accounts (alts).
export const discordIdentities = pgTable(
  'discord_identities',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    discordId: text('discord_id').notNull(),
    discordUsername: text('discord_username'),
    linkedAt: ts('linked_at').notNull().defaultNow(),
  },
  (t) => [index('discord_identities_discord_idx').on(t.discordId)],
);

// Discord OAuth `state`, single use. Only the hash is stored; the browser holds the value in a cookie too.
export const oauthStates = pgTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  mode: text('mode').notNull(), // login | link
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
});

// ---------------------------------------------------------------------------
// Alerts & notifications (phase 3)
// ---------------------------------------------------------------------------

// Per-account delivery preferences. Every channel and digest is opt-in.
export const notificationPrefs = pgTable('notification_prefs', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  discordDm: boolean('discord_dm').notNull().default(false),
  quietStartMin: integer('quiet_start_min'), // minutes after local midnight; null = no quiet hours
  quietEndMin: integer('quiet_end_min'),
  timeZone: text('time_zone').notNull().default('Europe/London'),
  dailyDigest: boolean('daily_digest').notNull().default(false),
  weeklyRecap: boolean('weekly_recap').notNull().default(false),
  coopActivity: boolean('coop_activity').notNull().default(false),
  mayorReminder: boolean('mayor_reminder').notNull().default(false),
  patchNotes: boolean('patch_notes').notNull().default(false),
  outages: boolean('outages').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// Price / anomaly / manipulation rules on bazaar items
export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // price | anomaly | manipulation
    productId: text('product_id').notNull(),
    side: text('side').notNull().default('buy'), // buy | sell price
    op: text('op'), // above | below (price rules)
    threshold: doublePrecision('threshold'), // coins (price) or z-score (anomaly)
    cooldownMinutes: integer('cooldown_minutes').notNull().default(60),
    armed: boolean('armed').notNull().default(true), // hysteresis: re-arms once the condition clears
    active: boolean('active').notNull().default(true),
    lastFiredAt: ts('last_fired_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('alert_rules_account_idx').on(t.accountId), index('alert_rules_product_idx').on(t.productId)],
);

// Money goals ("5B by March")
export const moneyGoals = pgTable('money_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull(),
  target: doublePrecision('target').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  reachedAt: ts('reached_at'),
});

// Outbox: every alert lands here; the bot delivers DMs, the site lists them.
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url'),
    dedupeKey: text('dedupe_key'), // one notification per key per account
    createdAt: ts('created_at').notNull().defaultNow(),
    deliverAfter: ts('deliver_after').notNull().defaultNow(), // pushed past quiet hours
    dmStatus: text('dm_status').notNull().default('none'), // none | pending | sent | failed
    readAt: ts('read_at'),
  },
  (t) => [
    index('notifications_account_idx').on(t.accountId, t.createdAt),
    index('notifications_dm_idx').on(t.dmStatus, t.deliverAfter),
    uniqueIndex('notifications_dedupe_idx').on(t.accountId, t.dedupeKey),
  ],
);

// SkyBlock news (patch notes) and the current election, for free notices and mayor reminders
export const skyblockNews = pgTable('skyblock_news', {
  id: text('id').primaryKey(), // link URL
  title: text('title').notNull(),
  publishedAt: ts('published_at'),
  seenAt: ts('seen_at').notNull().defaultNow(),
  announcedAt: ts('announced_at'),
});

export const skyblockElection = pgTable('skyblock_election', {
  id: text('id').primaryKey(), // 'current'
  year: integer('year'),
  mayor: text('mayor'),
  perks: jsonb('perks').notNull().default([]),
  candidates: jsonb('candidates').notNull().default([]),
  open: boolean('open').notNull().default(false),
  checkedAt: ts('checked_at').notNull(),
});

// ---------------------------------------------------------------------------
// Items, auctions, methods (phase 4)
// ---------------------------------------------------------------------------

export const items = pgTable('items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  tier: text('tier'),
  npcSellPrice: doublePrecision('npc_sell_price'),
  updatedAt: ts('updated_at').notNull(),
});

// Crafting recipes (optional source; see RECIPES_SOURCE_URL)
export const recipes = pgTable('recipes', {
  outputId: text('output_id').primaryKey(),
  outputCount: integer('output_count').notNull().default(1),
  inputs: jsonb('inputs').notNull(), // [{ id, count }]
  updatedAt: ts('updated_at').notNull(),
});

// Hourly auction sale prices from /skyblock/auctions_ended (BIN only)
export const auctionPrices = pgTable(
  'auction_prices',
  {
    itemId: text('item_id').notNull(),
    hour: ts('hour').notNull(),
    sales: integer('sales').notNull(),
    median: doublePrecision('median').notNull(),
    min: doublePrecision('min').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.hour] })],
);

// Raw BIN sales from /skyblock/auctions_ended, kept 2 days, rolled up hourly into auction_prices
export const auctionSales = pgTable(
  'auction_sales',
  {
    auctionId: text('auction_id').primaryKey(),
    itemId: text('item_id').notNull(),
    pricePerUnit: doublePrecision('price_per_unit').notNull(),
    soldAt: ts('sold_at').notNull(),
  },
  (t) => [index('auction_sales_sold_idx').on(t.soldAt)],
);

export const lowestBins = pgTable('lowest_bins', {
  itemId: text('item_id').primaryKey(),
  price: doublePrecision('price').notNull(),
  count: integer('count').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const watchlist = pgTable(
  'watchlist',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.productId] })],
);

export const bazaarAnomalies = pgTable(
  'bazaar_anomalies',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: text('product_id').notNull(),
    detectedAt: ts('detected_at').notNull().defaultNow(),
    z: doublePrecision('z').notNull(),
    price: doublePrecision('price').notNull(),
  },
  (t) => [index('bazaar_anomalies_detected_idx').on(t.detectedAt)],
);

export const bazaarCorrelations = pgTable(
  'bazaar_correlations',
  {
    productId: text('product_id').notNull(),
    otherId: text('other_id').notNull(),
    r: doublePrecision('r').notNull(),
    computedAt: ts('computed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.otherId] })],
);

export const electionHistory = pgTable('election_history', {
  year: integer('year').primaryKey(),
  mayor: text('mayor'),
  perks: jsonb('perks').notNull().default([]),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
});

// Custom money-making methods (Max). Built-in and generated methods live in code.
export const customMethods = pgTable('custom_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  spec: jsonb('spec').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// Hourly value of every public method, for method history charts
export const methodValues = pgTable(
  'method_values',
  {
    methodId: text('method_id').notNull(),
    hour: ts('hour').notNull(),
    value: doublePrecision('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.methodId, t.hour] })],
);

// Community ratings: votes only, no free text (keeps us out of user-to-user content rules)
export const methodVotes = pgTable(
  'method_votes',
  {
    methodId: text('method_id').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    vote: integer('vote').notNull(), // -1 | 1
    stillWorks: boolean('still_works'),
    difficulty: integer('difficulty'), // 1-5
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.methodId, t.accountId] })],
);

// ---------------------------------------------------------------------------
// Mod-powered insight (phase 5)
// ---------------------------------------------------------------------------

// Play sessions from mod heartbeats (a gap of 30+ minutes starts a new one)
export const playSessions = pgTable(
  'play_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    profileId: text('profile_id'),
    startedAt: ts('started_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    coinsStart: doublePrecision('coins_start'),
    coinsEnd: doublePrecision('coins_end'),
    activity: text('activity'), // only with activity insights on
    methodId: text('method_id'), // tagged by the player
  },
  (t) => [index('play_sessions_account_idx').on(t.accountId, t.startedAt)],
);

// Events the mod saw (rare drops). Only while tracking is on; follows tier retention.
export const modEvents = pgTable(
  'mod_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    profileId: text('profile_id'),
    at: ts('at').notNull(),
    type: text('type').notNull(), // rare_drop
    itemId: text('item_id'),
    itemName: text('item_name'),
    qty: integer('qty'),
  },
  (t) => [index('mod_events_account_idx').on(t.accountId, t.at)],
);

// Private chart notes ("bought Hyperion"). Pro and above; never shown to anyone else.
export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    profileId: text('profile_id').notNull(),
    at: ts('at').notNull(),
    text: text('text').notNull(),
  },
  (t) => [index('annotations_account_idx').on(t.accountId, t.profileId)],
);

// ---------------------------------------------------------------------------
// Social & community (phase 6). Everything here is opt-in.
// ---------------------------------------------------------------------------

// Materialised leaderboards (every 15 minutes), only players with showOnLeaderboards on
export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    board: text('board').notNull(), // gain | consistency | coop
    period: text('period').notNull(), // 7d | 30d
    scope: text('scope').notNull(), // global | mode:<gameMode>
    subject: text('subject').notNull(), // account id, or profile id for co-op boards
    rank: integer('rank').notNull(),
    value: doublePrecision('value').notNull(),
    label: text('label').notNull(), // username, or co-op name
    computedAt: ts('computed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.board, t.period, t.scope, t.subject] })],
);

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    followedId: uuid('followed_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followedId] })],
);

export const achievements = pgTable(
  'achievements',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    earnedAt: ts('earned_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.key] })],
);

// Discord-server grinding competitions. No entry fees and no prizes with money value.
export const competitions = pgTable('competitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  createdByDiscord: text('created_by_discord').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const competitionEntries = pgTable(
  'competition_entries',
  {
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.competitionId, t.accountId] })],
);

// Daily mini-games in Discord. Just for fun: no stakes, no prizes. Kept 30 days.
export const gameRounds = pgTable(
  'game_rounds',
  {
    game: text('game').notNull(), // guess | predict
    day: date('day', { mode: 'string' }).notNull(),
    productId: text('product_id').notNull(),
    startPrice: doublePrecision('start_price').notNull(),
    endPrice: doublePrecision('end_price'),
  },
  (t) => [primaryKey({ columns: [t.game, t.day] })],
);

export const gamePlays = pgTable(
  'game_plays',
  {
    game: text('game').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    discordId: text('discord_id').notNull(),
    answer: doublePrecision('answer').notNull(), // guessed price, or +1/-1 for up/down
    points: integer('points'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.game, t.day, t.discordId] })],
);

// ---------------------------------------------------------------------------
// Platform (phase 7)
// ---------------------------------------------------------------------------

// Public API keys (Max). Only the SHA-256 of the key is stored; the prefix is shown to the owner.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('api_keys_account_idx').on(t.accountId)],
);

// Outgoing webhooks for your own alerts (Max). Payloads are signed with the secret.
export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  failures: integer('failures').notNull().default(0),
  lastStatus: integer('last_status'),
  lastDeliveryAt: ts('last_delivery_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  minTier: text('min_tier'), // null = everyone
  rolloutPercent: integer('rollout_percent').notNull().default(100),
  description: text('description'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// Last success / failure per scheduled job, for "missed its window" alerts
export const jobRuns = pgTable('job_runs', {
  name: text('name').primaryKey(),
  lastOkAt: ts('last_ok_at'),
  lastErrorAt: ts('last_error_at'),
  lastError: text('last_error'),
  expectedEveryMinutes: integer('expected_every_minutes'),
});

// Gift subscriptions: bought with a one-off payment, redeemed with a code. Only the hash is stored.
export const giftCodes = pgTable('gift_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull().unique(),
  tier: text('tier').notNull(),
  months: integer('months').notNull().default(1),
  purchaserAccountId: uuid('purchaser_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  stripeSessionId: text('stripe_session_id').unique(),
  redeemedBy: uuid('redeemed_by').references(() => accounts.id, { onDelete: 'set null' }),
  redeemedAt: ts('redeemed_at'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
