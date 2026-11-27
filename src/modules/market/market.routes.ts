import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { priceSvg } from './embed.js';
import { marketRepo } from './market.repo.js';
import { marketService } from './market.service.js';

const id = z.object({ productId: z.string().regex(/^[A-Za-z0-9_:\-]{1,64}$/).transform((s) => s.toUpperCase()) });
const days = (max: number, def: number) => z.object({ days: z.coerce.number().int().min(1).max(max).default(def) });
const methodId = z.object({ id: z.string().min(1).max(100) });
const uuidParam = z.object({ id: z.string().uuid() });
const priceRef = z.object({ item: z.string().regex(/^[A-Z0-9_:\-]{1,64}$/), qty: z.number().finite().min(0).max(1e9), source: z.enum(['instasell', 'instabuy', 'npc', 'bin']).optional() });
const specBody = z.object({
  name: z.string().min(1).max(60),
  spec: z.object({
    unit: z.enum(['hour', 'action']),
    outputs: z.array(priceRef).max(30),
    inputs: z.array(priceRef).max(30),
    coins: z.number().finite().min(-1e12).max(1e12).optional(),
    requirements: z.array(z.string().max(80)).max(20).optional(),
  }),
});
const voteBody = z.object({ vote: z.union([z.literal(1), z.literal(-1)]), stillWorks: z.boolean().optional(), difficulty: z.number().int().min(1).max(5).optional() }).strict();
const cache = (s: number) => ({ 'cache-control': `public, max-age=${s}` });
const acct = (req: { auth: { accountId: string } | null }) => req.auth?.accountId ?? null;

export const marketRoutes: FastifyPluginAsync = async (app) => {
  // ---- free ----
  app.get('/v1/items', async (req) => ({ items: await marketService.searchItems(z.object({ q: z.string().min(1).max(64) }).parse(req.query).q) }));
  app.get('/v1/bazaar-insights/movers', async (req, reply) => {
    const { window } = z.object({ window: z.enum(['1h', '24h', '7d']).default('24h') }).parse(req.query);
    return reply.headers(cache(60)).send(await marketService.movers(window));
  });
  app.get('/v1/bazaar-insights/categories', async (_req, reply) => reply.headers(cache(300)).send({ categories: await marketService.categories() }));
  app.get('/v1/bazaar-insights/index', async (req, reply) => reply.headers(cache(300)).send(await marketService.economyIndex(days(365, 30).parse(req.query).days)));
  app.get('/v1/bazaar-insights/npc-arbitrage', async (_req, reply) => reply.headers(cache(60)).send({ items: await marketService.npcArbitrage() }));
  app.get('/v1/auctions/:productId', async (req) => marketService.auction(id.parse(req.params).productId, days(30, 7).parse(req.query).days));
  app.get('/v1/election/history', async () => marketService.electionHistory());

  // Embeddable chart: <img src="https://api.skystats.cc/v1/embed/bazaar/ENCHANTED_DIAMOND.svg">
  app.get('/v1/embed/bazaar/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[A-Za-z0-9_:\-]{1,64}\.svg$/) }).parse(req.params);
    const pid = file.slice(0, -4).toUpperCase();
    const { days: d } = days(90, 7).parse(req.query);
    const rows = await marketRepo.history([pid], new Date(Date.now() - d * 86_400_000));
    const name = pid.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return reply
      .headers({ ...cache(300), 'content-type': 'image/svg+xml; charset=utf-8', 'cross-origin-resource-policy': 'cross-origin' })
      .send(priceSvg(`${name} · ${d}d`, rows.map((r) => ({ t: r.takenAt.getTime(), v: r.buyPrice }))));
  });

  // ---- tier-gated insight (works signed out as Free) ----
  app.get('/v1/bazaar/:productId/depth', async (req) => marketService.depth(acct(req), id.parse(req.params).productId));
  app.get('/v1/bazaar/:productId/spread', async (req) => marketService.spread(acct(req), id.parse(req.params).productId, days(365, 7).parse(req.query).days));
  app.get('/v1/bazaar/:productId/seasonality', async (req) => marketService.seasonality(acct(req), id.parse(req.params).productId));
  app.get('/v1/bazaar/:productId/correlations', async (req) => marketService.correlations(acct(req), id.parse(req.params).productId));
  app.get('/v1/bazaar/:productId/craft', async (req) => marketService.craft(acct(req), id.parse(req.params).productId));
  app.get('/v1/bazaar-insights/flips', async (req) => marketService.flips(acct(req)));
  app.get('/v1/bazaar-insights/anomalies', async (req) => marketService.anomalies(acct(req)));

  // ---- watchlist ----
  const both = requireAuth(['web', 'bot']);
  app.get('/v1/me/watchlist', { preHandler: both }, async (req) => ({ items: await marketService.watchlist(req.auth!.accountId) }));
  app.put('/v1/me/watchlist/:productId', { preHandler: both }, async (req, reply) => {
    await marketService.watch(req.auth!.accountId, id.parse(req.params).productId);
    return reply.code(204).send();
  });
  app.delete('/v1/me/watchlist/:productId', { preHandler: both }, async (req, reply) => {
    await marketService.unwatch(req.auth!.accountId, id.parse(req.params).productId);
    return reply.code(204).send();
  });

  // ---- methods ----
  app.get('/v1/methods', async (req) => marketService.methods(acct(req)));
  app.get('/v1/methods/:id', async (req) => marketService.method(acct(req), methodId.parse(req.params).id));
  app.get('/v1/methods/:id/history', async (req) => marketService.methodHistory(acct(req), methodId.parse(req.params).id, days(365, 30).parse(req.query).days));
  app.put('/v1/methods/:id/vote', { preHandler: both }, async (req, reply) => {
    await marketService.vote(req.auth!.accountId, methodId.parse(req.params).id, voteBody.parse(req.body ?? {}));
    return reply.code(204).send();
  });
  app.post('/v1/me/methods', { preHandler: both }, async (req, reply) => {
    const { name, spec } = specBody.parse(req.body ?? {});
    return reply.code(201).send(await marketService.createCustom(req.auth!.accountId, name, spec));
  });
  app.put('/v1/me/methods/:id', { preHandler: both }, async (req) => {
    const { name, spec } = specBody.parse(req.body ?? {});
    return marketService.updateCustom(req.auth!.accountId, uuidParam.parse(req.params).id, name, spec);
  });
  app.delete('/v1/me/methods/:id', { preHandler: both }, async (req, reply) => {
    await marketService.deleteCustom(req.auth!.accountId, uuidParam.parse(req.params).id);
    return reply.code(204).send();
  });
};
