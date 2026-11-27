import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../http/middleware/adminAuth.js';
import { boss } from '../jobs/queue.js';
import { allQueues } from '../jobs/registry.js';
import { logger } from '../lib/logger.js';
import { bazaarService } from '../modules/bazaar/bazaar.service.js';

// Admin actions for the MCP server / ops tooling. All require the x-admin-key header.
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', adminAuth);

  app.get('/queues', async () => {
    const sizes = await Promise.all(
      allQueues.map(async (name) => ({ name, waiting: await boss.getQueueSize(name) })),
    );
    return { queues: sizes };
  });

  // Take a bazaar snapshot now instead of waiting for the cron
  app.post('/bazaar/snapshot', async (_req, reply) => {
    await bazaarService.requestSnapshot();
    return reply.code(202).send({ queued: true });
  });

  // Exits the process; the container's restart policy brings it back.
  app.post('/restart', async (_req, reply) => {
    logger.warn('restart requested via admin API');
    await reply.code(202).send({ restarting: true });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });
};
