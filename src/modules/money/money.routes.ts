import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { RANGES, moneyService, type Range } from './money.service.js';

const query = z.object({
  profileId: z.string().regex(/^[0-9a-fA-F-]{32,36}$/),
  range: z.enum(Object.keys(RANGES) as [Range, ...Range[]]).default('7d'),
});

export const moneyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me/money', { preHandler: requireAuth() }, async (req) => {
    const q = query.parse(req.query);
    return moneyService.history(req.auth!.accountId, req.auth!.playerUuid, q.profileId, q.range);
  });
};
