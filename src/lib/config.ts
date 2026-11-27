import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters'),

  // HTTP hardening
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'), // behind cloudflared / Caddy in production
  // Comma-separated browser origins allowed to call the API cross-origin, e.g. https://skystats.cc
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),

  HYPIXEL_API_BASE_URL: z.string().url().default('https://api.hypixel.net/v2'),
  // Only needed for keyed endpoints (player/profile data). Bazaar + status work without it.
  HYPIXEL_API_KEY: z.string().default(''),
  // Hypixel limits keys per 5-minute window; set this to your key's limit.
  HYPIXEL_RATE_LIMIT_PER_5MIN: z.coerce.number().positive().default(300),
  HYPIXEL_STATUS_URL: z.string().url().default('https://status.hypixel.net/api/v2/summary.json'),

  // Mojang session server: verifies mod logins (hasJoined) and looks up usernames
  MOJANG_SESSION_URL: z.string().url().default('https://sessionserver.mojang.com'),
  MOJANG_RATE_LIMIT_PER_MIN: z.coerce.number().positive().default(100),

  // Sessions
  SESSION_COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'), // auto = secure in production
  WEB_SESSION_DAYS: z.coerce.number().int().positive().default(30),
  MOD_SESSION_DAYS: z.coerce.number().int().positive().default(90),

  // SkyBlock profiles
  // On-demand profile lookups are cached this long. Keep it high: Hypixel forbids continuous polling.
  PROFILE_REFRESH_MIN_MINUTES: z.coerce.number().positive().default(60),
  MEMBER_SNAPSHOT_MIN_MINUTES: z.coerce.number().positive().default(5), // mod-reported money-history resolution

  // Billing (Stripe). Without STRIPE_SECRET_KEY, checkout and the portal return 503.
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  // Comma-separated Stripe price ids per tier (monthly, yearly, ...)
  STRIPE_PRICES_PRO: z.string().default('').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  STRIPE_PRICES_MAX: z.string().default('').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  PUBLIC_WEB_URL: z.string().url().default('https://skystats.cc'),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).default(7), // paid features after a failed payment
  SOFT_RETENTION_DAYS: z.coerce.number().int().min(0).default(30), // hidden-not-deleted window after downgrade

  // Discord login (OAuth2, scope "identify" only). Empty client id = Discord login off.
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  // Must match the redirect registered in the Discord developer portal. Same origin as the site,
  // so the session cookie lands on skystats.cc (Caddy proxies /v1 to the API).
  DISCORD_REDIRECT_URI: z.string().url().default('https://skystats.cc/v1/auth/discord/callback'),
  DISCORD_API_BASE_URL: z.string().url().default('https://discord.com/api/v10'),
  // Shared secret the bot sends as x-bot-key. Empty = bot access off. Never accepted through Cloudflare.
  BOT_API_KEY: z.string().default('').refine((v) => v === '' || v.length >= 32, 'BOT_API_KEY must be at least 32 characters'),

  BAZAAR_POLL_SECONDS: z.coerce.number().int().min(10).default(30),
  BAZAAR_SNAPSHOT_CRON: z.string().default('0 */2 * * *'), // every 2 hours
  STATUS_POLL_SECONDS: z.coerce.number().int().min(30).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isDev = config.NODE_ENV === 'development';
export const cookieSecure =
  config.SESSION_COOKIE_SECURE === 'auto' ? config.NODE_ENV === 'production' : config.SESSION_COOKIE_SECURE === 'true';
