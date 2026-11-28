import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, setSessionCookie } from '../../http/auth.js';
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { sseClients } from '../../lib/metrics.js';
import { accountsService } from '../accounts/accounts.service.js';
import { bazaarService } from '../bazaar/bazaar.service.js';
import { stripeRequest } from '../billing/stripe.js';
import { statusService } from '../status/status.service.js';
import { platformService } from './platform.service.js';

const web = requireAuth('web');
const id = z.object({ id: z.string().uuid() });

// Hub for the live bazaar stream: one DB read per tick, shared by every open stream
type Send = (data: string) => void;
const listeners = new Set<Send>();
let timer: NodeJS.Timeout | null = null;
let last = new Map<string, string>();
async function tick() {
  const products = await bazaarService.list();
  const changed = products.filter((p) => last.get(p.id) !== `${p.buyPrice}:${p.sellPrice}`);
  last = new Map(products.map((p) => [p.id, `${p.buyPrice}:${p.sellPrice}`]));
  if (changed.length === 0) return;
  const msg = `event: prices\ndata: ${JSON.stringify({ at: new Date().toISOString(), products: changed.map((p) => ({ id: p.id, buyPrice: p.buyPrice, sellPrice: p.sellPrice })) })}\n\n`;
  for (const l of listeners) l(msg);
}
function subscribe(send: Send) {
  listeners.add(send);
  sseClients.set(listeners.size);
  if (!timer) timer = setInterval(() => void tick().catch(() => {}), config.BAZAAR_POLL_SECONDS * 1000);
  return () => {
    listeners.delete(send);
    sseClients.set(listeners.size);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      last = new Map();
    }
  };
}
const MAX_STREAMS = 500;

// Read-only endpoints the batch call may fan out to
const BATCHABLE = [/^\/v1\/bazaar(\/[A-Za-z0-9_:\-]+)?$/, /^\/v1\/players\/[A-Za-z0-9_]{1,16}$/, /^\/v1\/status$/, /^\/v1\/election$/, /^\/v1\/items\/[A-Za-z0-9_:\-]+$/, /^\/v1\/me(\/[a-z\-]+)?$/];

export const platformRoutes: FastifyPluginAsync = async (app) => {
  // ---- API keys and webhooks: managed from the website only (never with an API key)
  app.get('/v1/me/api-keys', { preHandler: web }, async (req) => ({ keys: await platformService.listKeys(req.auth!.accountId) }));
  app.post('/v1/me/api-keys', { preHandler: web }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body ?? {});
    return reply.code(201).send(await platformService.createKey(req.auth!.accountId, name));
  });
  app.delete('/v1/me/api-keys/:id', { preHandler: web }, async (req, reply) => {
    await platformService.revokeKey(req.auth!.accountId, id.parse(req.params).id);
    return reply.code(204).send();
  });
  app.get('/v1/me/webhooks', { preHandler: web }, async (req) => ({ webhooks: await platformService.listWebhooks(req.auth!.accountId) }));
  app.post('/v1/me/webhooks', { preHandler: web }, async (req, reply) => {
    const { url } = z.object({ url: z.string().url().max(500) }).parse(req.body ?? {});
    return reply.code(201).send(await platformService.createWebhook(req.auth!.accountId, url));
  });
  app.delete('/v1/me/webhooks/:id', { preHandler: web }, async (req, reply) => {
    await platformService.deleteWebhook(req.auth!.accountId, id.parse(req.params).id);
    return reply.code(204).send();
  });
  app.post('/v1/me/webhooks/:id/test', { preHandler: web, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    await platformService.testWebhook(req.auth!.accountId, id.parse(req.params).id);
    return reply.code(202).send({ queued: true });
  });

  // ---- session rotation
  app.post('/v1/me/sessions/rotate', { preHandler: web, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const s = await accountsService.rotate(req.auth!, req.headers['user-agent']);
    setSessionCookie(reply, s.token);
    return { expiresAt: s.expiresAt };
  });

  // ---- feature flags (public: what's switched on for you)
  app.get('/v1/flags', async (req, reply) => {
    reply.header('cache-control', 'private, max-age=60');
    return { flags: await platformService.flagsFor(req.auth?.accountId ?? null) };
  });

  // ---- gifts
  app.post('/v1/billing/gift', { preHandler: web, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { tier } = z.object({ tier: z.enum(['pro', 'max']) }).parse(req.body ?? {});
    return platformService.giftCheckout(req.auth!.accountId, tier, (m, p, b) => stripeRequest<{ url: string }>(m as 'POST', p, b));
  });
  app.post('/v1/billing/redeem', { preHandler: web, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { code } = z.object({ code: z.string().trim().min(16).max(24) }).parse(req.body ?? {});
    return platformService.redeemGift(req.auth!.accountId, code);
  });

  // ---- live bazaar (Server-Sent Events). Free: raw prices, same as /v1/bazaar.
  app.get('/v1/bazaar/stream', async (req, reply) => {
    if (listeners.size >= MAX_STREAMS) throw new AppError(503, 'busy', 'Too many live streams open, try again shortly');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 10000\n\n`);
    const unsubscribe = subscribe((d) => res.write(d));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // ---- batch: up to 20 read-only GETs in one round trip (the bot and API users)
  app.post('/v1/batch', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { requests } = z.object({ requests: z.array(z.object({ path: z.string().max(200) })).min(1).max(20) }).parse(req.body ?? {});
    const headers: Record<string, string> = {};
    for (const h of ['cookie', 'authorization', 'x-api-key', 'x-bot-key', 'x-discord-user-id', 'cf-connecting-ip']) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    const results = await Promise.all(
      requests.map(async ({ path }) => {
        const pathname = path.split('?')[0]!;
        if (!BATCHABLE.some((r) => r.test(pathname)) || pathname === '/v1/batch') return { path, status: 400, body: { error: 'not_batchable' } };
        const r = await app.inject({ method: 'GET', url: path, headers });
        let body: unknown = r.body;
        try {
          body = r.json();
        } catch {
          /* not JSON */
        }
        return { path, status: r.statusCode, body };
      }),
    );
    return { results };
  });

  // ---- public API status
  app.get('/v1/api/status', async () => {
    const s = await statusService.get();
    return { api: 'ok', version: process.env.npm_package_version ?? null, upstream: s, docs: `${config.PUBLIC_WEB_URL}/developers` };
  });

};
