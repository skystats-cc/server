import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../http/middleware/adminAuth.js';
import { boss } from '../jobs/queue.js';
import { allQueueNames } from '../jobs/registry.js';
import { logger } from '../lib/logger.js';
import { z } from 'zod';
import { normalizeUuid, UUID_RE } from '../lib/ids.js';
import { bazaarService } from '../modules/bazaar/bazaar.service.js';
import { skyblockService } from '../modules/skyblock/skyblock.service.js';
import { platformRepo } from '../modules/platform/platform.repo.js';
import { platformService } from '../modules/platform/platform.service.js';
import { registry } from '../lib/metrics.js';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

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

  // ---- users (support). Lookup returns no money data: only what support needs.
  app.get('/users/:q', async (req) => platformService.adminUser(z.object({ q: z.string().min(1).max(36) }).parse(req.params).q));
  app.post('/users/:accountId/entitlement', async (req) => {
    const { accountId } = z.object({ accountId: z.string().uuid() }).parse(req.params);
    const { tier, days } = z.object({ tier: z.enum(['free', 'pro', 'max']), days: z.number().int().min(1).max(366).default(30) }).parse(req.body ?? {});
    return platformService.adminOverride(accountId, tier, days);
  });
  app.post('/users/:accountId/ban', async (req, reply) => {
    const { accountId } = z.object({ accountId: z.string().uuid() }).parse(req.params);
    const { banned, reason } = z.object({ banned: z.boolean(), reason: z.string().min(3).max(200) }).parse(req.body ?? {});
    await platformService.adminBan(accountId, banned, reason);
    return reply.code(204).send();
  });

  // ---- feature flags
  app.get('/flags', async () => ({ flags: await platformRepo.flags() }));
  app.put('/flags/:key', async (req) => {
    const { key } = z.object({ key: z.string().regex(/^[a-z0-9.\-]{2,48}$/) }).parse(req.params);
    const body = z.object({ enabled: z.boolean(), minTier: z.enum(['free', 'pro', 'max']).nullable().optional(), rolloutPercent: z.number().int().min(0).max(100).optional(), description: z.string().max(200).nullable().optional() }).parse(req.body ?? {});
    await platformRepo.setFlag(key, body);
    return { flags: await platformRepo.flags() };
  });

  // ---- jobs
  app.get('/jobs', async () => ({ jobs: await platformService.jobHealth() }));
  app.get('/jobs/failed', async () => {
    const rows = await db.execute(sql`select id, name, retry_count as "retryCount", completed_on as "failedAt", output from pgboss.job where state = 'failed' order by completed_on desc limit 50`);
    return { failed: rows };
  });
  app.post('/jobs/:queue/:id/retry', async (req, reply) => {
    const { queue, id } = z.object({ queue: z.string().refine((q) => allQueueNames.includes(q)), id: z.string().uuid() }).parse(req.params);
    await boss.retry(queue, id);
    return reply.code(202).send({ queued: true });
  });

  // ---- data quality and telemetry
  app.get('/data-quality', async () => platformRepo.dataQuality());
  app.get('/mod-versions', async () => ({ versions: await platformRepo.modVersions() }));

  // Rebuild money rollups for a range of days (after a bug fix)
  app.post('/rollups/backfill', async (req, reply) => {
    const { days } = z.object({ days: z.number().int().min(1).max(400) }).parse(req.body ?? {});
    await boss.send('money.rollup-backfill', { days });
    return reply.code(202).send({ queued: true });
  });

  // Prometheus scrape (also requires the admin key; the infra Prometheus sends it)
  app.get('/metrics', async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  // Exits the process; the container's restart policy brings it back.
  app.post('/restart', async (_req, reply) => {
    logger.warn('restart requested via admin API');
    await reply.code(202).send({ restarting: true });
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
  });
};
