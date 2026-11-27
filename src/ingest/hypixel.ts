import type { z } from 'zod';
import { config } from '../lib/config.js';
import { UpstreamError } from '../lib/errors.js';
import { TokenBucket } from './ratelimit.js';
import { bazaarResponseSchema, statusSummarySchema } from './schemas.js';

// All Hypixel calls go through here. Keyed calls share one rate limiter.
const perWindow = config.HYPIXEL_RATE_LIMIT_PER_5MIN;
const keyedBucket = new TokenBucket(perWindow, perWindow / 300_000);
const baseUrl = config.HYPIXEL_API_BASE_URL.replace(/\/$/, '');

async function getJson<T>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'skystats.cc', ...headers } });
  if (!res.ok) throw new UpstreamError(res.status, url);
  return schema.parse(await res.json());
}

export async function hypixelGet<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, opts: { keyed?: boolean } = {}) {
  if (opts.keyed) {
    if (!config.HYPIXEL_API_KEY) throw new Error('HYPIXEL_API_KEY is not set');
    await keyedBucket.take();
    return getJson(`${baseUrl}${path}`, schema, { 'API-Key': config.HYPIXEL_API_KEY });
  }
  return getJson(`${baseUrl}${path}`, schema);
}

export const fetchBazaar = () => hypixelGet('/skyblock/bazaar', bazaarResponseSchema);

export const fetchStatus = () => getJson(config.HYPIXEL_STATUS_URL, statusSummarySchema);
