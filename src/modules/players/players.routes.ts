import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { playersService } from './players.service.js';

const params = z.object({ name: z.string().regex(/^[A-Za-z0-9_]{1,16}$/) });

export const playersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/players/:name', async (req, reply) => {
    const { name } = params.parse(req.params);
    reply.header('cache-control', 'public, max-age=60');
    return playersService.publicSummary(name);
  });
};
