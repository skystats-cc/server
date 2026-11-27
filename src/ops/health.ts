import type { FastifyPluginAsync } from 'fastify';
import { sql } from '../db/client.js';

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
};
