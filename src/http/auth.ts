import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cookieSecure, config } from '../lib/config.js';
import { AppError, UnauthorizedError } from '../lib/errors.js';
import { safeEqualText } from '../lib/ids.js';
import { accountsRepo } from '../modules/accounts/accounts.repo.js';
import { accountsService, type AuthContext } from '../modules/accounts/accounts.service.js';
import { discordRepo } from '../modules/discord/discord.repo.js';
import { platformService } from '../modules/platform/platform.service.js';

export const SESSION_COOKIE = 'ss_session';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    /** Set when the Discord bot calls on behalf of a Discord user (linked or not) */
    bot: { discordUserId: string } | null;
    /** Set when the request used a public API key */
    apiKeyId: string | null;
  }
}

function tokenFrom(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return req.cookies?.[SESSION_COOKIE] ?? null;
}

/** Parses cookies and resolves `req.auth` on every request (null when signed out). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerAuth(app: FastifyInstance<any, any, any, any>) {
  await app.register(cookie);
  app.decorateRequest('auth', null);
  app.decorateRequest('bot', null);
  app.decorateRequest('apiKeyId', null);
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-bot-key'] !== undefined) return resolveBot(req);
    if (req.headers['x-api-key'] !== undefined) return resolveApiKey(req);
    const token = tokenFrom(req);
    req.auth = token ? await accountsService.resolveToken(token) : null;
  });
}

// API keys read data; they can't change anything or manage the account
const API_KEY_BLOCKED = ['/v1/me/api-keys', '/v1/me/webhooks', '/v1/me/sessions', '/v1/me/export', '/v1/me/delete', '/v1/billing', '/v1/auth', '/admin'];
async function resolveApiKey(req: FastifyRequest) {
  if (req.method !== 'GET' && !(req.method === 'POST' && req.url.split('?')[0] === '/v1/batch')) {
    throw new AppError(403, 'read_only_key', 'API keys are read-only');
  }
  if (API_KEY_BLOCKED.some((p) => req.url.startsWith(p))) throw new AppError(403, 'not_with_api_key', 'Manage your account on the website');
  const k = await platformService.resolveKey(String(req.headers['x-api-key']));
  if (!k) throw new AppError(401, 'unauthorized', 'Invalid API key');
  req.apiKeyId = k.keyId;
  req.auth = { sessionId: '', accountId: k.accountId, playerUuid: k.playerUuid, kind: 'api' };
}

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * The bot acts for a Discord user: x-bot-key + x-discord-user-id. Only on the internal network:
 * anything that came through Cloudflare carries cf-connecting-ip and is refused.
 */
async function resolveBot(req: FastifyRequest) {
  const key = String(req.headers['x-bot-key']);
  const discordUserId = String(req.headers['x-discord-user-id'] ?? '');
  if (!config.BOT_API_KEY || req.headers['cf-connecting-ip'] !== undefined || !safeEqualText(key, config.BOT_API_KEY)) {
    throw new AppError(401, 'unauthorized', 'Invalid bot credentials');
  }
  if (!SNOWFLAKE.test(discordUserId)) throw new AppError(400, 'bad_request', 'x-discord-user-id must be a Discord user id');
  req.bot = { discordUserId };
  const [primary] = await discordRepo.accountsFor(discordUserId);
  if (primary && !(await accountsRepo.isBanned(primary.accountId))) req.auth = { sessionId: '', accountId: primary.accountId, playerUuid: primary.uuid, kind: 'bot' };
}

/** preHandler: require a signed-in user, optionally of certain session kinds */
export function requireAuth(kind?: AuthContext['kind'] | AuthContext['kind'][]) {
  const kinds = kind === undefined ? null : Array.isArray(kind) ? kind : [kind];
  return async (req: FastifyRequest) => {
    if (!req.auth) {
      throw req.bot ? new AppError(401, 'not_linked', 'Link your Minecraft account first with /link') : new UnauthorizedError();
    }
    if (kinds && !kinds.includes(req.auth.kind)) {
      throw new UnauthorizedError(`This endpoint needs a ${kinds.join(' or ')} session`);
    }
  };
}

/** preHandler: the bot itself (no linked account needed) */
export async function requireBot(req: FastifyRequest) {
  if (!req.bot) throw new UnauthorizedError('Bot credentials required');
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    path: '/',
    maxAge: config.WEB_SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
