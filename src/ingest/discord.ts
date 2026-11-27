import { z } from 'zod';
import { config } from '../lib/config.js';
import { UpstreamError } from '../lib/errors.js';
import { CircuitBreaker } from './breaker.js';

// All Discord API calls go through here.
const breaker = new CircuitBreaker('Discord');
const base = () => config.DISCORD_API_BASE_URL.replace(/\/$/, '');

const tokenSchema = z.object({ access_token: z.string(), token_type: z.string() });
const userSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string(),
  global_name: z.string().nullable().optional(),
});
export type DiscordUser = z.infer<typeof userSchema>;

/** Exchange an OAuth code for the Discord user. The access token is used once and never stored. */
export async function discordUserFromCode(code: string): Promise<DiscordUser> {
  return breaker.run(async () => {
    const res = await fetch(`${base()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.DISCORD_REDIRECT_URI,
        client_id: config.DISCORD_CLIENT_ID,
        client_secret: config.DISCORD_CLIENT_SECRET,
      }),
    });
    if (!res.ok) throw new UpstreamError(res.status, 'discord oauth2/token');
    const token = tokenSchema.parse(await res.json());
    const me = await fetch(`${base()}/users/@me`, { headers: { Authorization: `${token.token_type} ${token.access_token}` } });
    if (!me.ok) throw new UpstreamError(me.status, 'discord users/@me');
    return userSchema.parse(await me.json());
  });
}

export function discordAuthorizeUrl(state: string) {
  const u = new URL('https://discord.com/oauth2/authorize');
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.DISCORD_CLIENT_ID,
    scope: 'identify', // no email, no guilds: data minimisation
    redirect_uri: config.DISCORD_REDIRECT_URI,
    state,
    prompt: 'none',
  }).toString();
  return u.toString();
}
