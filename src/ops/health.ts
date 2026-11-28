import type { FastifyPluginAsync } from 'fastify';
import { sql } from '../db/client.js';
import { config } from '../lib/config.js';
import { safeEqualText } from '../lib/ids.js';
import { registry } from '../lib/metrics.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Process is up
  app.get('/healthz', async () => ({ ok: true }));

  // Process can reach its dependencies
  app.get('/readyz', async (_req, reply) => {
    try {
      await sql`select 1`;
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, db: 'unreachable' });
    }
  });

  // Prometheus scrape. Off unless METRICS_TOKEN is set; refused for anything that came through Cloudflare.
  app.get('/metrics', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (!config.METRICS_TOKEN || req.headers['cf-connecting-ip'] !== undefined || !safeEqualText(auth, `Bearer ${config.METRICS_TOKEN}`)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.type(registry.contentType).send(await registry.metrics());
  });
};
