import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { bazaarRoutes } from '../modules/bazaar/bazaar.routes.js';
import { statusRoutes } from '../modules/status/status.routes.js';
import { adminRoutes } from '../ops/admin.js';
import { healthRoutes } from '../ops/health.js';

const UNLIMITED = ['/healthz', '/readyz', '/admin'];

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: config.TRUST_PROXY });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false,
    methods: ['GET'],
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    // Behind Cloudflare the real client IP is in cf-connecting-ip
    keyGenerator: (req) => String(req.headers['cf-connecting-ip'] ?? req.ip),
    allowList: (req) => UNLIMITED.some((p) => req.url.startsWith(p)),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Rate limit exceeded, retry in ${ctx.after}`,
    }),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid input', issues: err.issues });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    // Fastify / plugin errors (rate limit, bad JSON, etc.) carry their own 4xx status
    const e = err as { statusCode?: number; error?: string; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply
        .code(e.statusCode)
        .send({ error: e.statusCode === 429 ? 'rate_limited' : 'bad_request', message: e.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.register(healthRoutes);
  app.register(adminRoutes, { prefix: '/admin' });
  app.register(bazaarRoutes);
  app.register(statusRoutes);
  // Register new module routes here.

  return app;
}
