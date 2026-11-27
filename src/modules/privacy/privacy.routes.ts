import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, requireAuth } from '../../http/auth.js';
import { privacyService } from './privacy.service.js';

const patchBody = z
  .object({
    trackingEnabled: z.boolean(),
    profilePublic: z.boolean(),
    showOnLeaderboards: z.boolean(),
    allowActivityPings: z.boolean(),
    hideBank: z.boolean(),
    discordPublic: z.boolean(),
    showTierRole: z.boolean(),
  })
  .partial()
  .strict();

const deleteBody = z.object({ confirm: z.literal('DELETE') }).strict();

export const privacyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me/privacy', { preHandler: requireAuth(['web', 'bot']) }, async (req) => privacyService.get(req.auth!.accountId));

  app.patch('/v1/me/privacy', { preHandler: requireAuth(['web', 'bot']) }, async (req) =>
    privacyService.update(req.auth!.accountId, patchBody.parse(req.body ?? {}), req.auth!.kind),
  );

  // Right of access + portability. Free for everyone, a few times an hour.
  app.get(
    '/v1/me/export',
    { preHandler: requireAuth('web'), config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const data = await privacyService.exportData(req.auth!.accountId);
      return reply
        .header('content-disposition', `attachment; filename="skystats-export-${new Date().toISOString().slice(0, 10)}.json"`)
        .send(data);
    },
  );

  // Right to erasure. Web session only, with an explicit confirmation word.
  app.post('/v1/me/delete', { preHandler: requireAuth('web') }, async (req, reply) => {
    deleteBody.parse(req.body ?? {});
    await privacyService.deleteAccount(req.auth!.accountId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};
