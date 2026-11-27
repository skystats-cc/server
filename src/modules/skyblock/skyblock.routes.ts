import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../../http/auth.js';
import { skyblockService } from './skyblock.service.js';

export const skyblockRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me/profiles', { preHandler: requireAuth() }, async (req) => {
    const uuid = req.auth!.playerUuid;
    // Viewing your profiles keeps them fresh (no-op if fetched within the refresh interval)
    void skyblockService.requestRefresh(uuid).catch((err) => req.log.warn({ err }, 'refresh enqueue failed'));
    return skyblockService.myProfiles(uuid);
  });

  app.post(
    '/v1/me/profiles/refresh',
    { preHandler: requireAuth(), config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // Manual refresh: allowed once a minute per player
      const queued = await skyblockService.requestRefresh(req.auth!.playerUuid, { minMinutes: 1 });
      return reply.code(202).send({ queued });
    },
  );
};
