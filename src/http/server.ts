import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { accountsRoutes } from '../modules/accounts/accounts.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { bazaarRoutes } from '../modules/bazaar/bazaar.routes.js';
import { billingRoutes } from '../modules/billing/billing.routes.js';
import { modRoutes } from '../modules/mod/mod.routes.js';
import { moneyRoutes } from '../modules/money/money.routes.js';
import { pairingRoutes } from '../modules/pairing/pairing.routes.js';
import { playersRoutes } from '../modules/players/players.routes.js';
import { privacyRoutes } from '../modules/privacy/privacy.routes.js';
import { skyblockRoutes } from '../modules/skyblock/skyblock.routes.js';
import { statusRoutes } from '../modules/status/status.routes.js';
import { adminRoutes } from '../ops/admin.js';
import { healthRoutes } from '../ops/health.js';
import { registerAuth } from './auth.js';

const UNLIMITED = ['/healthz', '/readyz', '/admin'];

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: config.TRUST_PROXY });

  // Accept POSTs with a JSON content-type but no body (e.g. /v1/pairing, /v1/auth/logout)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined);
    }
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false,
    methods: ['GET'],
  });

  // Cookies + resolves req.auth (mod bearer token or web session cookie)
  await registerAuth(app);

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

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: 'not_found', message: `No route for ${req.method} ${req.url}` }),
  );

  await app.register(healthRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(bazaarRoutes);
  await app.register(statusRoutes);
  await app.register(authRoutes);
  await app.register(pairingRoutes);
  await app.register(accountsRoutes);
  await app.register(skyblockRoutes);
  await app.register(modRoutes);
  await app.register(moneyRoutes);
  await app.register(privacyRoutes);
  await app.register(billingRoutes);
  await app.register(playersRoutes);
  // Register new module routes here.

  return app;
}
