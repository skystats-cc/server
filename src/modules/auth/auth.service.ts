import { hasJoined } from '../../ingest/mojang.js';
import { AppError } from '../../lib/errors.js';
import { newServerId, normalizeUuid } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { accountsService } from '../accounts/accounts.service.js';
import { skyblockService } from '../skyblock/skyblock.service.js';
import { authRepo } from './auth.repo.js';

const CHALLENGE_TTL_MS = 2 * 60_000;

export const authService = {
  async createChallenge() {
    const serverId = newServerId();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await authRepo.createChallenge(serverId, expiresAt);
    return { serverId, expiresAt };
  },

  /**
   * The mod called Mojang joinServer(serverId). Ask Mojang whether `username` really did;
   * if so, that player owns the account and gets a mod token.
   */
  async verifyMod(username: string, serverId: string, userAgent?: string) {
    if (!(await authRepo.consumeChallenge(serverId))) {
      throw new AppError(401, 'invalid_challenge', 'Challenge expired or already used; start again');
    }
    const profile = await hasJoined(username, serverId);
    if (!profile) {
      throw new AppError(401, 'mojang_verification_failed', 'Mojang could not verify this Minecraft account');
    }

    const uuid = normalizeUuid(profile.id);
    const { id: accountId, created } = await accountsService.loginMinecraft(uuid, profile.name);
    const session = await accountsService.issueSession(accountId, 'mod', userAgent);
    if (created) logger.info({ uuid, username: profile.name }, 'new SkyStats account');

    // First thing a new user wants: their profiles. Respects the refresh interval.
    void skyblockService.requestRefresh(uuid).catch((err) => logger.warn({ err }, 'refresh enqueue failed'));

    return { ...session, account: await accountsService.get(accountId) };
  },
};
