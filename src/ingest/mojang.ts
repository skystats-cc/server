import { z } from 'zod';
import { config } from '../lib/config.js';
import { UpstreamError } from '../lib/errors.js';
import { TokenBucket } from './ratelimit.js';

const base = config.MOJANG_SESSION_URL.replace(/\/$/, '');
const perMin = config.MOJANG_RATE_LIMIT_PER_MIN;
const bucket = new TokenBucket(Math.max(1, Math.floor(perMin / 4)), perMin / 60_000);

const profileSchema = z.object({ id: z.string(), name: z.string() }).passthrough();
export type MojangProfile = z.infer<typeof profileSchema>;

async function getProfile(url: string): Promise<MojangProfile | null> {
  await bucket.take();
  const res = await fetch(url, {
    headers: { 'User-Agent': 'skystats.cc' },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(res.status, url.replace(/\?.*/, ''));
  return profileSchema.parse(await res.json());
}

/**
 * True identity check for the mod: the client called Mojang's joinServer(serverId) with its access token;
 * Mojang confirms here that this username did so. We never see the player's token.
 */
export function hasJoined(username: string, serverId: string) {
  const q = new URLSearchParams({ username, serverId });
  return getProfile(`${base}/session/minecraft/hasJoined?${q}`);
}

/** Current username for a UUID (null if the account doesn't exist) */
export function lookupProfile(uuid: string) {
  return getProfile(`${base}/session/minecraft/profile/${uuid}`);
}
