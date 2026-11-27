import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { adminAuth } from '../http/middleware/adminAuth.js';
import { boss } from '../jobs/queue.js';
import { allQueues } from '../jobs/registry.js';
import { logger } from '../lib/logger.js';
import { playersService } from '../modules/players/players.service.js';

// Admin actions for the MCP server / ops tooling. All require the x-admin-key header.
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', adminAuth);

  app.get('/queues', async () => {
    const sizes = await Promise.all(
      allQueues.map(async (name) => ({ name, waiting: await boss.getQueueSize(name) })),
    );
    return { queues: sizes };
  });

  app.post('/players/:uuid/refresh', async (req, reply) => {
    const { uuid } = z.object({ uuid: z.string().min(1) }).parse(req.params);
    await playersService.requestRefresh(uuid);
    return reply.code(202).send({ queued: uuid });
  });

  // Exits the process; the container's restart policy brings it back.
  app.post('/restart', async (_req, reply) => {
    logger.warn('restart requested via admin API');
    await reply.code(202).send({ restarting: true });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });
};
