import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { accountsService } from '../accounts/accounts.service.js';
import { alertsService } from '../alerts/alerts.service.js';
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
  })
  .strict();

export const modRoutes: FastifyPluginAsync = async (app) => {
  // Presence only. It no longer triggers Hypixel API lookups (no polling for histories).
  app.post('/v1/mod/heartbeat', { preHandler: requireAuth('mod') }, async (req) => {
    const { modVersion } = heartbeatBody.parse(req.body);
    const before = await accountsService.get(req.auth!.accountId);
    const account = await accountsService.heartbeat(req.auth!.accountId, modVersion);
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
