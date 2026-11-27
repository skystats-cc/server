import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { privacyService } from '../privacy/privacy.service.js';
import { insightService } from './insight.service.js';

const both = requireAuth(['web', 'bot']);
const profileQ = z.object({ profileId: z.string().regex(/^[0-9a-fA-F-]{32,36}$/), days: z.coerce.number().int().min(1).max(3650).default(30) });
const daysQ = z.object({ days: z.coerce.number().int().min(1).max(3650).default(7) });
const uuidParam = z.object({ id: z.string().uuid() });

export const insightRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me/play-sessions', { preHandler: both }, async (req) => {
    const { days } = daysQ.parse(req.query);
    const p = await privacyService.get(req.auth!.accountId);
    return { sessions: await insightService.sessions(req.auth!.accountId, days, p.activityInsights) };
  });
  app.patch('/v1/me/play-sessions/:id', { preHandler: both }, async (req, reply) => {
    const { methodId } = z.object({ methodId: z.string().min(1).max(100).nullable() }).strict().parse(req.body ?? {});
    await insightService.tagSession(req.auth!.accountId, uuidParam.parse(req.params).id, methodId);
    return reply.code(204).send();
  });

  app.get('/v1/me/money/days', { preHandler: both }, async (req) => {
    const q = profileQ.parse(req.query);
    return insightService.days(req.auth!.accountId, req.auth!.playerUuid, q.profileId, q.days);
  });
  app.get('/v1/me/money/breakdown', { preHandler: both }, async (req) => {
    const q = profileQ.parse(req.query);
    return insightService.breakdown(req.auth!.accountId, req.auth!.playerUuid, q.profileId, q.days);
  });
  app.get('/v1/me/money/compare', { preHandler: both }, async (req) => {
    const q = profileQ.parse(req.query);
    return insightService.comparePeriods(req.auth!.accountId, req.auth!.playerUuid, q.profileId, Math.min(q.days, 90));
  });
  app.get('/v1/me/money.csv', { preHandler: requireAuth('web') }, async (req, reply) => {
    const q = profileQ.parse(req.query);
    const csv = await insightService.csv(req.auth!.accountId, req.auth!.playerUuid, q.profileId);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="skystats-money.csv"').send(csv);
  });
  app.get('/v1/me/drops', { preHandler: both }, async (req) => insightService.drops(req.auth!.accountId, daysQ.parse(req.query).days));

  app.get('/v1/me/annotations', { preHandler: both }, async (req) => insightService.annotations(req.auth!.accountId, profileQ.parse(req.query).profileId));
  app.post('/v1/me/annotations', { preHandler: both }, async (req, reply) => {
    const b = z.object({ profileId: z.string().regex(/^[0-9a-fA-F-]{32,36}$/), at: z.coerce.date(), text: z.string().min(1).max(120) }).strict().parse(req.body ?? {});
    return reply.code(201).send(await insightService.addAnnotation(req.auth!.accountId, b.profileId, b.at, b.text));
  });
  app.delete('/v1/me/annotations/:id', { preHandler: both }, async (req, reply) => {
    await insightService.deleteAnnotation(req.auth!.accountId, uuidParam.parse(req.params).id);
    return reply.code(204).send();
  });

  app.get('/v1/me/methods-performance/:id', { preHandler: both }, async (req) =>
    insightService.methodPerformance(req.auth!.accountId, z.object({ id: z.string().min(1).max(100) }).parse(req.params).id),
  );

  app.get('/v1/me/coop/:profileId', { preHandler: both }, async (req) => {
    const { profileId } = z.object({ profileId: z.string().regex(/^[0-9a-fA-F-]{32,36}$/) }).parse(req.params);
    const { days } = daysQ.parse(req.query);
    void insightService.refreshMembers(req.auth!.playerUuid).catch(() => {});
    return insightService.coop(req.auth!.accountId, req.auth!.playerUuid, profileId, days);
  });
};
