import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authService } from './auth.service.js';

const verifyBody = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{1,16}$/),
  serverId: z.string().regex(/^[a-f0-9]{40}$/),
});

const strict = { rateLimit: { max: 20, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v1/auth/mod/challenge', { config: strict }, async () => authService.createChallenge());

  app.post('/v1/auth/mod/verify', { config: strict }, async (req) => {
    const { username, serverId } = verifyBody.parse(req.body);
    return authService.verifyMod(username, serverId, req.headers['user-agent']);
  });
};
