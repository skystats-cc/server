import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireBot, setSessionCookie } from '../../http/auth.js';
import { cookieSecure } from '../../lib/config.js';
import { discordService } from './discord.service.js';

const STATE_COOKIE = 'ss_oauth';
const startQuery = z.object({ mode: z.enum(['login', 'link']).default('login') });
const callbackQuery = z.object({ code: z.string().max(200).optional(), state: z.string().max(100).optional(), error: z.string().max(100).optional() });
const switchBody = z.object({ uuid: z.string().regex(/^[0-9a-f]{32}$/) }).strict();
const snowflake = z.object({ discordId: z.string().regex(/^\d{17,20}$/) });
const strict = { rateLimit: { max: 20, timeWindow: '1 minute' } };

export const discordRoutes: FastifyPluginAsync = async (app) => {
  // Browser navigates here; we redirect to Discord.
  app.get('/v1/auth/discord/start', { config: strict }, async (req, reply) => {
    const { mode } = startQuery.parse(req.query);
    const accountId = req.auth?.kind === 'web' ? req.auth.accountId : null;
    const { url, state } = await discordService.start(mode, accountId);
    reply.setCookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/v1/auth/discord', maxAge: 600 });
    return reply.redirect(url);
  });

  app.get('/v1/auth/discord/callback', { config: strict }, async (req, reply) => {
    const q = callbackQuery.parse(req.query);
    const result = await discordService.callback(q, req.cookies[STATE_COOKIE], req.headers['user-agent']);
    reply.clearCookie(STATE_COOKIE, { path: '/v1/auth/discord' });
    if (result.session) setSessionCookie(reply, result.session.token);
    return reply.redirect(result.redirect);
  });

  app.get('/v1/me/discord', { preHandler: requireAuth(['web', 'bot']) }, async (req) => discordService.status(req.auth!.accountId));

  app.delete('/v1/me/discord', { preHandler: requireAuth('web') }, async (req, reply) => {
    await discordService.unlink(req.auth!.accountId);
    return reply.code(204).send();
  });

  app.get('/v1/me/accounts', { preHandler: requireAuth(['web', 'bot']) }, async (req) => ({
    accounts: await discordService.siblings(req.auth!.accountId),
  }));

  app.post('/v1/me/switch', { preHandler: requireAuth('web'), config: strict }, async (req, reply) => {
    const { uuid } = switchBody.parse(req.body ?? {});
    // The route sets the new cookie; return the account the browser is now signed in as
    const session = await discordService.switchTo(req.auth!.accountId, req.auth!.sessionId, uuid, req.headers['user-agent']);
    setSessionCookie(reply, session.token);
    return { switched: true };
  });

  // ---- bot only ----
  app.get('/v1/bot/whois/:discordId', { preHandler: requireBot }, async (req) => discordService.whois(snowflake.parse(req.params).discordId));
  app.get('/v1/bot/role-sync', { preHandler: requireBot }, async () => discordService.roleSync());
};
