import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, requireAuth } from '../../http/auth.js';
import { NotFoundError } from '../../lib/errors.js';
import { audit } from '../audit/audit.repo.js';
import { accountsRepo } from './accounts.repo.js';
import { accountsService } from './accounts.service.js';

const settingsBody = z.object({ trackingEnabled: z.boolean().optional() }).strict();

export const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me', { preHandler: requireAuth() }, async (req) => accountsService.get(req.auth!.accountId));

  app.patch('/v1/me/settings', { preHandler: requireAuth() }, async (req) => {
    const settings = settingsBody.parse(req.body ?? {});
    return accountsService.updateSettings(req.auth!.accountId, settings);
  });

  // Sessions & devices: see and sign out browsers and mods
  app.get('/v1/me/sessions', { preHandler: requireAuth('web') }, async (req) => ({
    sessions: (await accountsRepo.listSessions(req.auth!.accountId))
      .map((s) => ({ ...s, current: s.id === req.auth!.sessionId }))
      .sort((a, b) => Number(b.current) - Number(a.current) || (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0)),
  }));

  app.delete('/v1/me/sessions/:sessionId', { preHandler: requireAuth('web') }, async (req, reply) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
    if (!(await accountsRepo.deleteOwnSession(req.auth!.accountId, sessionId))) throw new NotFoundError('session');
    await audit.log('user', 'session.revoked', req.auth!.accountId);
    if (sessionId === req.auth!.sessionId) clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.post('/v1/me/sessions/revoke-others', { preHandler: requireAuth('web') }, async (req) => {
    const revoked = await accountsRepo.deleteOtherSessions(req.auth!.accountId, req.auth!.sessionId);
    await audit.log('user', 'session.revoked_others', req.auth!.accountId, { revoked });
    return { revoked };
  });

  app.post('/v1/auth/logout', { preHandler: requireAuth() }, async (req, reply) => {
    await accountsService.logout(req.auth!.sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
