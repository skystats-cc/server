import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cookieSecure, config } from '../lib/config.js';
import { UnauthorizedError } from '../lib/errors.js';
import { accountsService, type AuthContext } from '../modules/accounts/accounts.service.js';

export const SESSION_COOKIE = 'ss_session';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
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
  app.addHook('onRequest', async (req) => {
    const token = tokenFrom(req);
    req.auth = token ? await accountsService.resolveToken(token) : null;
  });
}

/** preHandler: require a signed-in user, optionally of one session kind */
export function requireAuth(kind?: AuthContext['kind']) {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw new UnauthorizedError();
    if (kind && req.auth.kind !== kind) throw new UnauthorizedError(`This endpoint needs a ${kind} session`);
  };
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
