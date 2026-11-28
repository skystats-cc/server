import { config } from '../../lib/config.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { newToken, sha256 } from '../../lib/ids.js';
import { accountsRepo, type AccountRow } from './accounts.repo.js';

export interface AuthContext {
  sessionId: string;
  accountId: string;
  playerUuid: string;
  kind: 'mod' | 'web' | 'bot' | 'api';
}

export function toAccountDto(a: AccountRow) {
  return {
    uuid: a.uuid,
    username: a.username ?? '',
    trackingEnabled: a.trackingEnabled,
    modLastSeenAt: a.modLastSeenAt,
    modVersion: a.modVersion,
    createdAt: a.createdAt,
  };
}

const TOUCH_EVERY_MS = 5 * 60_000;

export const accountsService = {
  /** Called after Mojang confirmed the player. Creates the account on first login. */
  async loginMinecraft(uuid: string, username: string) {
    await accountsRepo.upsertPlayer(uuid, username);
    return accountsRepo.ensureAccount(uuid);
  },

  async issueSession(accountId: string, kind: 'mod' | 'web', userAgent?: string) {
    if (await accountsRepo.isBanned(accountId)) throw new ForbiddenError('banned', 'This account is suspended. Contact support if you think this is a mistake.');
    const token = newToken(kind === 'mod' ? 'ssm' : 'ssw');
    const days = kind === 'mod' ? config.MOD_SESSION_DAYS : config.WEB_SESSION_DAYS;
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await accountsRepo.createSession({ accountId, kind, tokenHash: sha256(token), expiresAt, userAgent });
    return { token, expiresAt };
  },

  async resolveToken(token: string): Promise<AuthContext | null> {
    if (token.length > 200) return null;
    const s = await accountsRepo.findSession(sha256(token));
    if (!s) return null;
    if (!s.lastUsedAt || Date.now() - s.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      void accountsRepo.touchSession(s.sessionId).catch(() => {});
    }
    return {
      sessionId: s.sessionId,
      accountId: s.accountId,
      playerUuid: s.playerUuid,
      kind: s.kind === 'mod' ? 'mod' : 'web',
    };
  },

  async get(accountId: string) {
    const a = await accountsRepo.getAccount(accountId);
    if (!a) throw new NotFoundError('account');
    return toAccountDto(a);
  },

  async updateSettings(accountId: string, settings: { trackingEnabled?: boolean }) {
    await accountsRepo.updateSettings(accountId, settings);
    return this.get(accountId);
  },

  async heartbeat(accountId: string, modVersion: string) {
    await accountsRepo.recordHeartbeat(accountId, modVersion);
    return this.get(accountId);
  },

  logout: (sessionId: string) => accountsRepo.deleteSession(sessionId),

  /** Swap the web session token for a fresh one (the site does this daily) so a leaked cookie stops working */
  async rotate(auth: AuthContext, userAgent?: string) {
    if (auth.kind !== 'web') throw new ForbiddenError('web_only', 'Only web sessions rotate');
    const next = await this.issueSession(auth.accountId, 'web', userAgent);
    await accountsRepo.deleteSession(auth.sessionId);
    return next;
  },
};
