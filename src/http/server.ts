import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import etag from '@fastify/etag';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { httpDuration } from '../lib/metrics.js';
import { captureError } from '../lib/sentry.js';
import { platformRoutes } from '../modules/platform/platform.routes.js';
import { accountsRoutes } from '../modules/accounts/accounts.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { bazaarRoutes } from '../modules/bazaar/bazaar.routes.js';
import { alertsRoutes } from '../modules/alerts/alerts.routes.js';
import { billingRoutes } from '../modules/billing/billing.routes.js';
import { discordRoutes } from '../modules/discord/discord.routes.js';
import { insightRoutes } from '../modules/insight/insight.routes.js';
import { marketRoutes } from '../modules/market/market.routes.js';
import { modRoutes } from '../modules/mod/mod.routes.js';
import { moneyRoutes } from '../modules/money/money.routes.js';
import { pairingRoutes } from '../modules/pairing/pairing.routes.js';
import { playersRoutes } from '../modules/players/players.routes.js';
import { socialRoutes } from '../modules/social/social.routes.js';
import { privacyRoutes } from '../modules/privacy/privacy.routes.js';
import { skyblockRoutes } from '../modules/skyblock/skyblock.routes.js';
import { statusRoutes } from '../modules/status/status.routes.js';
import { adminRoutes } from '../ops/admin.js';
import { healthRoutes } from '../ops/health.js';
import { registerAuth } from './auth.js';

const UNLIMITED = ['/healthz', '/readyz', '/admin', '/metrics'];

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.TRUST_PROXY,
    // Request IDs: reuse Cloudflare's ray id or a caller's x-request-id, else make one. Echoed back so
    // a user can quote it in a bug report and we can find the log line.
    genReqId: (req) => {
      const given = req.headers['x-request-id'] ?? req.headers['cf-ray'];
      return typeof given === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(given) ? given : randomUUID();
    },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    httpDuration.observe({ method: req.method, route: req.routeOptions?.url ?? 'unknown', status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  // Weak ETags on GET responses: clients send If-None-Match and get a 304 with no body
  await app.register(etag, { weak: true });

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
    // API keys get their own, larger quota; everyone else is limited per IP
    max: (req) => (req.apiKeyId ? config.API_KEY_RATE_LIMIT_PER_MIN : config.RATE_LIMIT_PER_MIN),
    timeWindow: '1 minute',
    // Behind Cloudflare the real client IP is in cf-connecting-ip
    keyGenerator: (req) => (req.apiKeyId ? `key:${req.apiKeyId}` : String(req.headers['cf-connecting-ip'] ?? req.ip)),
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
    captureError(err, { route: req.routeOptions?.url ?? 'unknown', requestId: String(req.id) });
    return reply.code(500).send({ error: 'internal_error', requestId: req.id });
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
  await app.register(discordRoutes);
  await app.register(alertsRoutes);
  await app.register(marketRoutes);
  await app.register(insightRoutes);
  await app.register(socialRoutes);
  await app.register(platformRoutes);
  // Register new module routes here.

  return app;
}
