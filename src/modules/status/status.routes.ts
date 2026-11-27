import type { FastifyPluginAsync } from 'fastify';
import { statusService } from './status.service.js';

export const statusRoutes: FastifyPluginAsync = async (app) => {
  // Powers the "is SkyBlock down?" topbar and the bot's /status
  app.get('/v1/status', async () => statusService.get());
};
