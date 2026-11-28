import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { accountsService } from '../accounts/accounts.service.js';
import { alertsService } from '../alerts/alerts.service.js';
import { insightService } from '../insight/insight.service.js';
import { privacyService } from '../privacy/privacy.service.js';
import { moneyService } from '../money/money.service.js';

const HEARTBEAT_SECONDS = 300;
const SESSION_GAP_MS = 30 * 60_000;
const SNAPSHOT_SECONDS = 300;
const heartbeatBody = z.object({
  modVersion: z.string().min(1).max(32),
  minecraftVersion: z.string().min(1).max(32),
});

const coins = z.number().finite().min(0).max(1e13);
const snapshotBody = z
  .object({
    profileId: z.string().regex(/^[0-9a-fA-F-]{32,36}$/),
    purse: coins,
    personalBank: coins.nullable().optional(),
    profileBank: coins.nullable().optional(),
    skyblockXp: z.number().finite().min(0).max(1e7).nullable().optional(),
    // Item ids and counts from the player's own inventory; only the total value is stored
    inventory: z.array(z.object({ id: z.string().regex(/^[A-Z0-9_:\-]{1,64}$/), count: z.number().int().min(1).max(100_000) })).max(300).optional(),
  })
  .strict();

const eventsBody = z
  .object({
    profileId: z.string().regex(/^[0-9a-fA-F-]{32,36}$/).nullable().optional(),
    events: z
      .array(
        z.object({
          type: z.literal('rare_drop'),
          at: z.number().int(),
          itemName: z.string().min(1).max(80),
          itemId: z.string().regex(/^[A-Z0-9_:\-]{1,64}$/).optional(),
          qty: z.number().int().min(1).max(10_000).optional(),
        }),
      )
      .max(100),
  })
  .strict();

export const modRoutes: FastifyPluginAsync = async (app) => {
  // Presence only. It no longer triggers Hypixel API lookups (no polling for histories).
  app.post('/v1/mod/heartbeat', { preHandler: requireAuth('mod') }, async (req) => {
    const { modVersion } = heartbeatBody.parse(req.body);
    const before = await accountsService.get(req.auth!.accountId);
    const account = await accountsService.heartbeat(req.auth!.accountId, modVersion);
    if (account.trackingEnabled) void insightService.onHeartbeat(req.auth!.accountId).catch((err) => req.log.warn({ err }, 'session update failed'));
    // A new play session (no heartbeat for 30+ minutes): co-op activity alerts, if this player allows them
    const lastSeen = before.modLastSeenAt?.getTime() ?? 0;
    if (Date.now() - lastSeen > SESSION_GAP_MS) {
      void privacyService
        .get(req.auth!.accountId)
        .then((p) => alertsService.coopSessionStarted(account.uuid, p.allowActivityPings))
        .catch((err) => req.log.warn({ err }, 'co-op activity alert failed'));
    }
    return {
      ok: true,
      trackingEnabled: account.trackingEnabled,
      nextHeartbeatSeconds: HEARTBEAT_SECONDS,
      snapshotEverySeconds: SNAPSHOT_SECONDS,
    };
  });

  // Rare drops the player saw in their own chat (only while tracking is on)
  app.post('/v1/mod/events', { preHandler: requireAuth('mod'), config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = eventsBody.parse(req.body);
    const account = await accountsService.get(req.auth!.accountId);
    await insightService.addEvents(req.auth!.accountId, account.trackingEnabled, body.profileId ?? null, body.events);
    return reply.code(202).send({ accepted: body.events.length });
  });

  // The player's own client reports their own coins (purse from the scoreboard, banks from the bank menu).
  app.post(
    '/v1/mod/snapshot',
    { preHandler: requireAuth('mod'), config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = snapshotBody.parse(req.body);
      const result = await moneyService.reportFromMod(req.auth!.accountId, body);
      return reply.code(result.stored ? 201 : 202).send(result);
    },
  );
};
