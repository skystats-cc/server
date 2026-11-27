import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, requireAuth } from '../../http/auth.js';
import { accountsService } from './accounts.service.js';

const settingsBody = z.object({ trackingEnabled: z.boolean().optional() }).strict();

export const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me', { preHandler: requireAuth() }, async (req) => accountsService.get(req.auth!.accountId));

  app.patch('/v1/me/settings', { preHandler: requireAuth() }, async (req) => {
    const settings = settingsBody.parse(req.body ?? {});
    return accountsService.updateSettings(req.auth!.accountId, settings);
  });

  app.post('/v1/auth/logout', { preHandler: requireAuth() }, async (req, reply) => {
    await accountsService.logout(req.auth!.sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
