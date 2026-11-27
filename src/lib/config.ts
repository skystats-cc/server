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
