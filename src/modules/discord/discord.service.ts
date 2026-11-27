import { randomBytes } from 'node:crypto';
import { discordAuthorizeUrl, discordUserFromCode, type DiscordUser } from '../../ingest/discord.js';
import { config } from '../../lib/config.js';
import { AppError, ConflictError, ForbiddenError, UnavailableError } from '../../lib/errors.js';
import { sha256 } from '../../lib/ids.js';
import { accountsService } from '../accounts/accounts.service.js';
import { audit } from '../audit/audit.repo.js';
import { effectiveTier, TIER_ORDER, type Tier } from '../entitlements/tiers.js';
import { discordRepo } from './discord.repo.js';

const STATE_TTL_MS = 10 * 60_000;

export const enabled = () => Boolean(config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET);
const best = (tiers: Tier[]) => tiers.reduce<Tier>((a, t) => (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(a) ? t : a), 'free');

export const discordService = {
  /** Start OAuth. Returns the Discord URL and the state value the route puts in a cookie. */
  async start(mode: 'login' | 'link', accountId: string | null) {
    if (!enabled()) throw new UnavailableError('Discord login is not set up');
    if (mode === 'link' && !accountId) throw new AppError(401, 'unauthorized', 'Sign in first to link Discord');
    const state = randomBytes(32).toString('base64url');
    await discordRepo.saveState(sha256(state), mode, accountId, new Date(Date.now() + STATE_TTL_MS));
    return { url: discordAuthorizeUrl(state), state };
  },

  /**
   * OAuth callback. `cookieState` must equal `state` (binds the flow to this browser, stops login CSRF).
   * Returns where to send the browser, and a web session to set when signing in.
   */
  async callback(params: { code?: string; state?: string; error?: string }, cookieState: string | undefined, userAgent?: string) {
    if (!params.state || !cookieState || params.state !== cookieState) return { redirect: '/link?discord=invalid' };
    const row = await discordRepo.takeState(sha256(params.state));
    if (!row) return { redirect: '/link?discord=expired' };
    if (params.error || !params.code) return { redirect: row.mode === 'link' ? '/settings?discord=cancelled' : '/link?discord=cancelled' };

    const user = await discordUserFromCode(params.code);

    if (row.mode === 'link') {
      const accountId = row.accountId!;
      try {
        await this.linkAccount(accountId, user, 'web');
      } catch (err) {
        if (err instanceof ForbiddenError) return { redirect: '/settings?discord=alt_needs_plan' };
        throw err;
      }
      return { redirect: '/settings?discord=linked' };
    }

    const [primary] = await discordRepo.accountsFor(user.id);
    if (!primary) return { redirect: '/link?discord=not_linked' };
    await discordRepo.touchLogin(primary.accountId);
    const session = await accountsService.issueSession(primary.accountId, 'web', userAgent);
    await audit.log('user', 'auth.discord_login', primary.accountId);
    return { redirect: '/me', session };
  },

  /**
   * Link a Discord user to a Minecraft account. A second (alt) Minecraft account on the same
   * Discord user needs Pro or Max on one of them.
   */
  async linkAccount(accountId: string, user: Pick<DiscordUser, 'id' | 'username'>, via: 'web' | 'bot') {
    const others = (await discordRepo.accountsFor(user.id)).filter((a) => a.accountId !== accountId);
    if (others.length > 0) {
      const ents = await discordRepo.entitlementsOf([accountId, ...others.map((o) => o.accountId)]);
      if (best(ents.map((e) => effectiveTier(e))) === 'free') {
        throw new ForbiddenError('upgrade_required', 'Linking more than one Minecraft account to a Discord user needs Pro or Max');
      }
    }
    await discordRepo.link(accountId, user.id, user.username);
    await audit.log('user', 'discord.linked', accountId, { via });
  },

  async status(accountId: string) {
    const d = await discordRepo.forAccount(accountId);
    return { enabled: enabled(), linked: Boolean(d), discordUsername: d?.discordUsername ?? null, linkedAt: d?.linkedAt ?? null };
  },

  async unlink(accountId: string) {
    if (!(await discordRepo.unlink(accountId))) throw new ConflictError('not_linked', 'Discord is not linked');
    await audit.log('user', 'discord.unlinked', accountId);
  },

  /** Minecraft accounts that share this account's Discord user */
  async siblings(accountId: string) {
    const d = await discordRepo.forAccount(accountId);
    if (!d) return [];
    return (await discordRepo.accountsFor(d.discordId)).map((a) => ({
      uuid: a.uuid,
      username: a.username,
      current: a.accountId === accountId,
    }));
  },

  /** Web: switch the session to another of your Minecraft accounts (same Discord user) */
  async switchTo(accountId: string, currentSessionId: string, targetUuid: string, userAgent?: string) {
    const d = await discordRepo.forAccount(accountId);
    const target = d ? (await discordRepo.accountsFor(d.discordId)).find((a) => a.uuid === targetUuid) : undefined;
    if (!target) throw new AppError(404, 'not_found', 'That account is not linked to your Discord');
    await accountsService.logout(currentSessionId);
    await discordRepo.touchLogin(target.accountId);
    await audit.log('user', 'auth.switched_account', target.accountId);
    return accountsService.issueSession(target.accountId, 'web', userAgent);
  },

  /** Bot: /whois. Only accounts whose owner made the Discord link public. */
  async whois(discordId: string) {
    const rows = (await discordRepo.accountsFor(discordId)).filter((a) => a.discordPublic);
    if (rows.length === 0) throw new AppError(404, 'not_found', 'No public SkyStats link for that user');
    return { accounts: rows.map((r) => ({ uuid: r.uuid, username: r.username ?? '', profilePublic: r.profilePublic })) };
  },

  /** Bot: who should have which role in the SkyStats server. Opt-in only. */
  async roleSync() {
    const byUser = new Map<string, { linked: boolean; tier: Tier }>();
    for (const r of await discordRepo.roleSyncRows()) {
      const cur = byUser.get(r.discordId) ?? { linked: false, tier: 'free' as Tier };
      if (r.discordPublic) cur.linked = true;
      if (r.showTierRole && r.tier) {
        cur.tier = best([cur.tier, effectiveTier({ tier: r.tier, status: r.status ?? 'none', currentPeriodEnd: r.currentPeriodEnd, graceUntil: r.graceUntil })]);
      }
      byUser.set(r.discordId, cur);
    }
    return { members: [...byUser].map(([discordId, v]) => ({ discordId, ...v })) };
  },
};
