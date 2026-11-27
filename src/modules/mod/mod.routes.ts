import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { accountsService } from '../accounts/accounts.service.js';
import { skyblockService } from '../skyblock/skyblock.service.js';

const HEARTBEAT_SECONDS = 300;
const heartbeatBody = z.object({
  modVersion: z.string().min(1).max(32),
  minecraftVersion: z.string().min(1).max(32),
});

export const modRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v1/mod/heartbeat', { preHandler: requireAuth('mod') }, async (req) => {
    const { modVersion } = heartbeatBody.parse(req.body);
    const account = await accountsService.heartbeat(req.auth!.accountId, modVersion);
    // While someone plays with tracking on, keep their profiles + co-op fresh
    if (account.trackingEnabled) {
      void skyblockService.requestRefresh(account.uuid).catch((err) => req.log.warn({ err }, 'refresh enqueue failed'));
    }
    return { ok: true, trackingEnabled: account.trackingEnabled, nextHeartbeatSeconds: HEARTBEAT_SECONDS };
  });
};
