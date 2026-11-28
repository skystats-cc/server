import { randomBytes } from 'node:crypto';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { audit } from '../audit/audit.repo.js';

const PAIRING_FAILURES_PER_HOUR = 10;
import { formatPairingCode, newPairingCode, normalizePairingCode, safeEqualHex, sha256 } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { accountsService } from '../accounts/accounts.service.js';
import { discordRepo } from '../discord/discord.repo.js';
import { discordService } from '../discord/discord.service.js';
import { pairingRepo } from './pairing.repo.js';

const TTL_MS = 10 * 60_000;
const POLL_SECONDS = 2;

export const pairingService = {
  /** Website (or the bot for /link): create a code to show. The secret authorizes polling. */
  async create(discord?: { id: string; username: string | null }) {
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode();
      const id = await pairingRepo.create(code, sha256(secret), expiresAt, discord);
      if (id) {
        const pretty = formatPairingCode(code);
        return {
          id,
          code: pretty,
          command: `/skystats link ${pretty}`,
          secret,
          expiresAt,
          pollIntervalSeconds: POLL_SECONDS,
        };
      }
    }
    throw new Error('could not allocate a pairing code');
  },

  /**
   * Website: check status. When linked, returns a fresh web session token exactly once
   * (the route turns it into an HttpOnly cookie).
   */
  async poll(id: string, secret: string, userAgent?: string) {
    const p = await pairingRepo.get(id);
    // Wrong secret looks the same as a missing pairing
    if (!p || !safeEqualHex(p.secretHash, sha256(secret))) throw new NotFoundError('pairing');

    if (p.status === 'consumed') return { status: 'expired' as const };
    if (p.status === 'pending') {
      return { status: p.expiresAt.getTime() < Date.now() ? ('expired' as const) : ('pending' as const) };
    }

    const accountId = await pairingRepo.consume(id);
    if (!accountId) return { status: 'expired' as const }; // raced with another poll
    const session = await accountsService.issueSession(accountId, 'web', userAgent);
    return { status: 'linked' as const, account: await accountsService.get(accountId), session };
  },

  /** Mod: the player typed /skystats link CODE and confirmed */
  async claim(rawCode: string, accountId: string) {
    const code = normalizePairingCode(rawCode);
    if (!code) throw new AppError(400, 'invalid_code', 'That doesn\'t look like a SkyStats code (e.g. ABCD-EFGH)');

    // Abuse limit: codes are short, so stop anyone guessing them
    if ((await audit.countRecent(accountId, 'pairing.claim_failed', 60)) >= PAIRING_FAILURES_PER_HOUR) {
      throw new AppError(429, 'too_many_attempts', 'Too many wrong codes. Try again in an hour.');
    }
    const linked = await pairingRepo.link(code, accountId);
    if (!linked) {
      await audit.log('user', 'pairing.claim_failed', accountId);
      const existing = await pairingRepo.findByCode(code);
      if (!existing) throw new AppError(404, 'invalid_code', 'Code not found. Check it on skystats.cc/link');
      throw new AppError(410, 'expired_code', 'That code has expired or was already used. Get a new one on skystats.cc/link');
    }
    logger.info({ accountId }, 'pairing linked');
    // Started from Discord (/link): link that Discord user too
    if (linked.discordId) {
      await discordService
        .linkAccount(accountId, { id: linked.discordId, username: linked.discordUsername ?? '' }, 'bot')
        .catch((err) => logger.info({ err: (err as Error).message }, 'discord link from pairing skipped'));
    }
    return { linked: true as const, account: await accountsService.get(accountId) };
  },

  /** Bot: has the player confirmed the code in game yet? Only the Discord user who started it may ask. */
  async botStatus(id: string, discordId: string) {
    const p = await pairingRepo.get(id);
    if (!p || p.discordId !== discordId) throw new NotFoundError('pairing');
    if (p.status !== 'pending') {
      const account = p.accountId ? await accountsService.get(p.accountId).catch(() => null) : null;
      const identity = p.accountId ? await discordRepo.forAccount(p.accountId) : null;
      return {
        status: account ? ('linked' as const) : ('expired' as const),
        username: account?.username ?? null,
        // false when this would be a second account on a free plan (alts need Pro or Max)
        discordLinked: identity?.discordId === discordId,
      };
    }
    return { status: p.expiresAt.getTime() < Date.now() ? ('expired' as const) : ('pending' as const), username: null, discordLinked: false };
  },
};
