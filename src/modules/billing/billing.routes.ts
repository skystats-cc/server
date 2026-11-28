import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../http/auth.js';
import { config } from '../../lib/config.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { billingService } from './billing.service.js';
import { verifyStripeSignature } from './stripe.signature.js';

const checkoutBody = z.object({ tier: z.enum(['pro', 'max']), interval: z.enum(['month', 'year']).default('month') }).strict();

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/me/entitlement', { preHandler: requireAuth() }, async (req) => entitlementsService.describe(req.auth!.accountId));

  app.post('/v1/billing/checkout', { preHandler: requireAuth('web') }, async (req) => {
    const { tier, interval } = checkoutBody.parse(req.body ?? {});
    return billingService.checkout(req.auth!.accountId, tier, interval);
  });

  app.post('/v1/billing/portal', { preHandler: requireAuth('web') }, async (req) => billingService.portal(req.auth!.accountId));

  // Webhooks need the raw body for signature checks, so this scope parses JSON as a string.
  await app.register(async (hook) => {
    hook.removeContentTypeParser('application/json');
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hook.post('/v1/billing/stripe-webhook', { config: { rateLimit: false } }, async (req, reply) => {
      const raw = String(req.body ?? '');
      if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, config.STRIPE_WEBHOOK_SECRET)) {
        return reply.code(400).send({ error: 'bad_signature' });
      }
      const processed = await billingService.handleEvent(JSON.parse(raw));
      return { received: true, duplicate: !processed };
    });
  });
};
