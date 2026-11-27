import { randomBytes } from 'node:crypto';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { formatPairingCode, newPairingCode, normalizePairingCode, safeEqualHex, sha256 } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { accountsService } from '../accounts/accounts.service.js';
import { pairingRepo } from './pairing.repo.js';

const TTL_MS = 10 * 60_000;
const POLL_SECONDS = 2;

export const pairingService = {
  /** Website: create a code to show. The secret stays in the browser and authorizes polling. */
  async create() {
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode();
      const id = await pairingRepo.create(code, sha256(secret), expiresAt);
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

    if (!(await pairingRepo.link(code, accountId))) {
      const existing = await pairingRepo.findByCode(code);
      if (!existing) throw new AppError(404, 'invalid_code', 'Code not found. Check it on skystats.cc/link');
      throw new AppError(410, 'expired_code', 'That code has expired or was already used. Get a new one on skystats.cc/link');
    }
    logger.info({ accountId }, 'pairing linked');
    return { linked: true as const, account: await accountsService.get(accountId) };
  },
};
