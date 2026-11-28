import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireBot, setSessionCookie } from '../../http/auth.js';
import { pairingService } from './pairing.service.js';

const idParams = z.object({ pairingId: z.string().uuid() });
const pollBody = z.object({ secret: z.string().min(20).max(128) });
const claimBody = z.object({ code: z.string().max(16) });

export const pairingRoutes: FastifyPluginAsync = async (app) => {
  app.post('/v1/pairing', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_req, reply) =>
    reply.code(201).send(await pairingService.create()),
  );

  // Polled every ~2s by the link page, so it gets a generous limit of its own
  app.post(
    '/v1/pairing/:pairingId/poll',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { pairingId } = idParams.parse(req.params);
      const { secret } = pollBody.parse(req.body);
      const result = await pairingService.poll(pairingId, secret, req.headers['user-agent']);
      if (result.status === 'linked') {
        setSessionCookie(reply, result.session.token);
        return { status: result.status, account: result.account };
      }
      return result;
    },
  );

  // Bot /link: the code is tied to the Discord user, so claiming it links Discord as well
  const botBody = z.object({ discordUsername: z.string().max(64).nullable().optional() }).strict();
  app.post('/v1/bot/pairing', { preHandler: requireBot }, async (req, reply) => {
    const { discordUsername } = botBody.parse(req.body ?? {});
    const p = await pairingService.create({ id: req.bot!.discordUserId, username: discordUsername ?? null });
    return reply.code(201).send({ id: p.id, code: p.code, command: p.command, expiresAt: p.expiresAt });
  });
  app.get('/v1/bot/pairing/:pairingId', { preHandler: requireBot }, async (req) => {
    const { pairingId } = idParams.parse(req.params);
    return pairingService.botStatus(pairingId, req.bot!.discordUserId);
  });

  app.post(
    '/v1/pairing/claim',
    { preHandler: requireAuth('mod'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { code } = claimBody.parse(req.body);
      return pairingService.claim(code, req.auth!.accountId);
    },
  );
};
