import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../http/middleware/adminAuth.js';
import { boss } from '../jobs/queue.js';
import { allQueueNames } from '../jobs/registry.js';
import { logger } from '../lib/logger.js';
import { z } from 'zod';
import { normalizeUuid, UUID_RE } from '../lib/ids.js';
import { bazaarService } from '../modules/bazaar/bazaar.service.js';
import { skyblockService } from '../modules/skyblock/skyblock.service.js';

// Admin actions for the MCP server / ops tooling. All require the x-admin-key header.
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', adminAuth);

  app.get('/queues', async () => {
    const sizes = await Promise.all(
      allQueueNames.map(async (name) => ({ name, waiting: await boss.getQueueSize(name) })),
    );
    return { queues: sizes };
  });

  // Take a bazaar snapshot now instead of waiting for the cron
  app.post('/bazaar/snapshot', async (_req, reply) => {
    await bazaarService.requestSnapshot();
    return reply.code(202).send({ queued: true });
  });

  // Refresh one player's SkyBlock profiles now (ignores the refresh interval)
  app.post('/players/:uuid/refresh', async (req, reply) => {
    const { uuid } = z
      .object({ uuid: z.string().transform(normalizeUuid).pipe(z.string().regex(UUID_RE)) })
      .parse(req.params);
    const queued = await skyblockService.requestRefresh(uuid, { minMinutes: 0 });
    return reply.code(202).send({ queued });
  });

  // Exits the process; the container's restart policy brings it back.
  app.post('/restart', async (_req, reply) => {
    logger.warn('restart requested via admin API');
    await reply.code(202).send({ restarting: true });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });
};
