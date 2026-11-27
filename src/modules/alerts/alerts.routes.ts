import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireBot } from '../../http/auth.js';
import { alertsService } from './alerts.service.js';

const minutes = z.number().int().min(0).max(1439);
const prefsBody = z
  .object({
    discordDm: z.boolean(),
    quietStartMin: minutes.nullable(),
    quietEndMin: minutes.nullable(),
    timeZone: z.string().min(1).max(64),
    dailyDigest: z.boolean(),
    weeklyRecap: z.boolean(),
    coopActivity: z.boolean(),
    mayorReminder: z.boolean(),
    patchNotes: z.boolean(),
    outages: z.boolean(),
  })
  .partial()
  .strict();

const ruleBody = z
  .object({
    kind: z.enum(['price', 'anomaly', 'manipulation']),
    productId: z.string().regex(/^[A-Z0-9_:]{1,64}$/),
    side: z.enum(['buy', 'sell']).default('buy'),
    op: z.enum(['above', 'below']).optional(),
    threshold: z.number().finite().positive().max(1e13).optional(),
    cooldownMinutes: z.number().int().min(5).max(10_080).default(60),
  })
  .strict();

const goalBody = z.object({ profileId: z.string().regex(/^[0-9a-f]{32}$/), target: z.number().finite().positive().max(1e13) }).strict();
const idParams = z.object({ id: z.string().uuid() });
const both = requireAuth(['web', 'bot']);

export const alertsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me/notification-prefs', { preHandler: both }, async (req) => alertsService.prefs(req.auth!.accountId));
  app.patch('/v1/me/notification-prefs', { preHandler: both }, async (req) => alertsService.updatePrefs(req.auth!.accountId, prefsBody.parse(req.body ?? {})));

  app.get('/v1/me/alerts', { preHandler: both }, async (req) => ({ alerts: await alertsService.listRules(req.auth!.accountId) }));
  app.post('/v1/me/alerts', { preHandler: both }, async (req, reply) =>
    reply.code(201).send(await alertsService.createRule(req.auth!.accountId, ruleBody.parse(req.body ?? {}))),
  );
  app.delete('/v1/me/alerts/:id', { preHandler: both }, async (req, reply) => {
    await alertsService.deleteRule(req.auth!.accountId, idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.get('/v1/me/goals', { preHandler: both }, async (req) => ({ goals: await alertsService.listGoals(req.auth!.accountId) }));
  app.post('/v1/me/goals', { preHandler: both }, async (req, reply) => {
    const { profileId, target } = goalBody.parse(req.body ?? {});
    return reply.code(201).send(await alertsService.createGoal(req.auth!.accountId, profileId, target));
  });
  app.delete('/v1/me/goals/:id', { preHandler: both }, async (req, reply) => {
    await alertsService.deleteGoal(req.auth!.accountId, idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.get('/v1/me/notifications', { preHandler: both }, async (req) => ({ notifications: await alertsService.listNotifications(req.auth!.accountId) }));
  app.post('/v1/me/notifications/read-all', { preHandler: both }, async (req, reply) => {
    await alertsService.markAllRead(req.auth!.accountId);
    return reply.code(204).send();
  });

  // Public
  app.get('/v1/news', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { news: await alertsService.listNews() };
  });
  app.get('/v1/election', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return (await alertsService.election()) ?? { mayor: null, perks: [], candidates: [], open: false, year: null, checkedAt: null };
  });

  // Bot delivery
  app.post('/v1/bot/notifications/claim', { preHandler: requireBot }, async (req) => {
    const { limit } = z.object({ limit: z.number().int().min(1).max(100).default(25) }).parse(req.body ?? {});
    return { notifications: await alertsService.claimDue(limit) };
  });
  app.post('/v1/bot/notifications/:id/result', { preHandler: requireBot }, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const { ok } = z.object({ ok: z.boolean() }).parse(req.body ?? {});
    await alertsService.setDmStatus(id, ok);
    return reply.code(204).send();
  });
  app.get('/v1/bot/news/unannounced', { preHandler: requireBot }, async () => ({ news: await alertsService.unannouncedNews() }));
  app.post('/v1/bot/news/announced', { preHandler: requireBot }, async (req, reply) => {
    const { id } = z.object({ id: z.string().url() }).parse(req.body ?? {});
    await alertsService.markAnnounced(id);
    return reply.code(204).send();
  });
};
