import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { playersService } from './players.service.js';

// Thin HTTP layer: validate input, call the service, return the result.
const params = z.object({ uuid: z.string().min(1).max(64) });
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });

export const playerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/players/:uuid', async (req) => {
    const { uuid } = params.parse(req.params);
    return playersService.getPlayer(uuid);
  });

  app.get('/v1/players/:uuid/history', async (req) => {
    const { uuid } = params.parse(req.params);
    const { limit } = historyQuery.parse(req.query);
    return { snapshots: await playersService.getHistory(uuid, limit) };
  });
};
