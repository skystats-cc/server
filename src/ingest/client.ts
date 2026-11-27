import type { z } from 'zod';
import { config } from '../lib/config.js';
import { UpstreamError } from '../lib/errors.js';
import { TokenBucket } from './ratelimit.js';
import { upstreamPlayerSchema } from './schemas.js';

const perMin = config.UPSTREAM_RATE_LIMIT_PER_MIN;
const bucket = new TokenBucket(perMin, perMin / 60_000);
const baseUrl = config.UPSTREAM_API_BASE_URL.replace(/\/$/, '');

async function upstreamGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  await bucket.take();
  const res = await fetch(`${baseUrl}${path}`, {
    // TODO: adjust the auth header name for your upstream API
    headers: config.UPSTREAM_API_KEY ? { 'API-Key': config.UPSTREAM_API_KEY } : {},
  });
  if (!res.ok) throw new UpstreamError(res.status, path);
  return schema.parse(await res.json());
}

export function fetchPlayer(uuid: string) {
  return upstreamGet(`/player?uuid=${encodeURIComponent(uuid)}`, upstreamPlayerSchema);
}
