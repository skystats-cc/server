import Fastify from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { playerRoutes } from '../modules/players/players.routes.js';
import { adminRoutes } from '../ops/admin.js';
import { healthRoutes } from '../ops/health.js';

export function buildServer() {
  const app = Fastify({ loggerInstance: logger });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'bad_request', issues: err.issues });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.register(healthRoutes);
  app.register(adminRoutes, { prefix: '/admin' });
  app.register(playerRoutes);
  // Register new module routes here.

  return app;
}
