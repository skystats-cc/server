import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { giftCodes } from '../../db/schema.js';
import { boss } from '../../jobs/queue.js';
import { config } from '../../lib/config.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { sha256 } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { audit } from '../audit/audit.repo.js';
import { entitlementsRepo } from '../entitlements/entitlements.repo.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { effectiveTier, type Tier } from '../entitlements/tiers.js';
import { flagOn } from './flags.js';
import { platformRepo } from './platform.repo.js';
import { newGiftCode, signPayload } from './helpers.js';
import { assertPublicHttpsUrl } from './ssrf.js';

export { cronIntervalMinutes, newGiftCode, signPayload } from './helpers.js';

export const PLATFORM_QUEUES = { webhook: 'platform.webhook', jobHealth: 'platform.job-health' } as const;
export const MAX_KEYS = 5;
export const MAX_WEBHOOKS = 3;
const DAY = 86_400_000;

export interface ApiKeyAuth {
  keyId: string;
  accountId: string;
  playerUuid: string;
}

const normGift = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const platformService = {
  // ------------------------------------------------------------ API keys (Max)
  async createKey(accountId: string, name: string) {
    await entitlementsService.require(accountId, 'api.public_keys');
    if ((await platformRepo.countKeys(accountId)) >= MAX_KEYS) throw new ConflictError('too_many_keys', `You can have up to ${MAX_KEYS} keys`);
    const key = `ssk_${randomBytes(24).toString('base64url')}`;
    const row = await platformRepo.createKey({ accountId, name, prefix: key.slice(0, 10), keyHash: sha256(key) });
    await audit.log('user', 'api_key.created', accountId, { keyId: row.id });
    // The full key is shown once; we only keep its hash
    return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt, lastUsedAt: null, key };
  },
  listKeys: (accountId: string) => platformRepo.listKeys(accountId),
  async revokeKey(accountId: string, id: string) {
    if (!(await platformRepo.revokeKey(accountId, id))) throw new NotFoundError('api key');
    await audit.log('user', 'api_key.revoked', accountId, { keyId: id });
  },
  /** Resolves x-api-key. The key stops working the moment the plan lapses below Max. */
  async resolveKey(key: string): Promise<ApiKeyAuth | null> {
    if (!key.startsWith('ssk_') || key.length > 100) return null;
    const k = await platformRepo.keyByHash(sha256(key));
    if (!k || k.bannedAt) return null;
    const tier = await entitlementsService.tierOf(k.accountId);
    if (tier !== 'max') throw new ForbiddenError('upgrade_required', 'API keys need SkyStats Max');
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 5 * 60_000) void platformRepo.touchKey(k.id).catch(() => {});
    return { keyId: k.id, accountId: k.accountId, playerUuid: k.playerUuid };
  },

  // ------------------------------------------------------------ webhooks (Max)
  async createWebhook(accountId: string, url: string) {
    await entitlementsService.require(accountId, 'api.public_keys');
    if ((await platformRepo.listWebhooks(accountId)).length >= MAX_WEBHOOKS) throw new ConflictError('too_many_webhooks', `You can have up to ${MAX_WEBHOOKS} webhooks`);
    try {
      await assertPublicHttpsUrl(url);
    } catch (e) {
      throw new AppError(400, 'bad_request', (e as Error).message);
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const row = await platformRepo.createWebhook({ accountId, url, secret });
    await audit.log('user', 'webhook.created', accountId, { webhookId: row.id });
    return { ...toWebhookDto(row), secret };
  },
  async listWebhooks(accountId: string) {
    return (await platformRepo.listWebhooks(accountId)).map(toWebhookDto);
  },
  async deleteWebhook(accountId: string, id: string) {
    if (!(await platformRepo.deleteWebhook(accountId, id))) throw new NotFoundError('webhook');
  },
  async testWebhook(accountId: string, id: string) {
    const w = await platformRepo.webhook(id);
    if (!w || w.accountId !== accountId) throw new NotFoundError('webhook');
    await boss.send(PLATFORM_QUEUES.webhook, { webhookId: id, event: { type: 'test', title: 'Test from SkyStats', body: 'Your webhook works.', at: new Date().toISOString() } });
  },
  /** Called for every new notification. Only Max accounts have webhooks, so this is cheap for everyone else. */
  async fanOut(accountId: string, n: { kind: string; title: string; body: string; url?: string | null }) {
    const hooks = await platformRepo.activeWebhooks(accountId);
    if (hooks.length === 0) return;
    if ((await entitlementsService.tierOf(accountId)) !== 'max') return;
    const event = { type: `alert.${n.kind}`, title: n.title, body: n.body, url: n.url ?? null, at: new Date().toISOString() };
    for (const h of hooks) await boss.send(PLATFORM_QUEUES.webhook, { webhookId: h.id, event }, { retryLimit: 5, retryBackoff: true });
  },
  /** Worker: one delivery. Re-checks the URL (DNS can change), no redirects, 5 s timeout, small response read. */
  async deliver(webhookId: string, event: Record<string, unknown>) {
    const w = await platformRepo.webhook(webhookId);
    if (!w || !w.active) return;
    await assertPublicHttpsUrl(w.url);
    const body = JSON.stringify(event);
    let status = 0;
    try {
      const res = await fetch(w.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', 'user-agent': 'SkyStats-Webhooks/1', 'skystats-signature': signPayload(w.secret, body) },
        body,
      });
      status = res.status;
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      logger.info({ webhookId, err: (err as Error).message }, 'webhook delivery failed');
    }
    const ok = status >= 200 && status < 300;
    await platformRepo.webhookResult(webhookId, status, ok);
    if (!ok) throw new Error(`webhook returned ${status}`); // pg-boss retries with backoff
  },

  // ------------------------------------------------------------ feature flags
  async flagsFor(accountId: string | null) {
    const tier: Tier = await entitlementsService.tierOf(accountId);
    const flags = await platformRepo.flags();
    return Object.fromEntries(flags.map((f) => [f.key, flagOn(f, accountId, tier)]));
  },

  // ------------------------------------------------------------ gifts
  /** Checkout for a one-off gift (one month of Pro or Max). Buyer gets a code to pass on. */
  async giftCheckout(accountId: string, tier: 'pro' | 'max', stripe: (m: string, p: string, b: Record<string, string>) => Promise<{ url: string }>) {
    const price = tier === 'max' ? config.STRIPE_GIFT_PRICE_MAX : config.STRIPE_GIFT_PRICE_PRO;
    if (!price) throw new ConflictError('price_not_configured', `Gifts of ${tier} are not available yet`);
    const s = await stripe('POST', '/checkout/sessions', {
      mode: 'payment',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: accountId,
      'metadata[kind]': 'gift',
      'metadata[tier]': tier,
      success_url: `${config.PUBLIC_WEB_URL}/billing?gift=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.PUBLIC_WEB_URL}/pricing`,
      'consent_collection[terms_of_service]': 'required',
      'custom_text[terms_of_service_acceptance][message]':
        'A gift is one month of the plan for whoever redeems the code. Unredeemed codes can be refunded within 14 days of buying. Prices include VAT.',
      'automatic_tax[enabled]': 'true',
      allow_promotion_codes: 'true',
    });
    return { url: s.url };
  },
  /** From the Stripe webhook: create the code (idempotent per checkout session). Returns the code once. */
  async issueGift(sessionId: string, purchaserAccountId: string | null, tier: string) {
    if (tier !== 'pro' && tier !== 'max') return null;
    const code = newGiftCode();
    const rows = await db
      .insert(giftCodes)
      .values({ codeHash: sha256(normGift(code)), tier, purchaserAccountId, stripeSessionId: sessionId, expiresAt: new Date(Date.now() + 730 * DAY) })
      .onConflictDoNothing()
      .returning({ id: giftCodes.id });
    if (rows.length === 0) return null;
    await audit.log('stripe', 'gift.issued', purchaserAccountId, { giftId: rows[0]!.id, tier });
    if (purchaserAccountId) {
      const { alertsService } = await import('../alerts/alerts.service.js');
      // The code reaches the buyer in their inbox on the site (and by DM if they opted in)
      await alertsService.notify(purchaserAccountId, { kind: 'gift', title: 'Your SkyStats gift code', body: `Code: ${code} (one month of ${tier === 'max' ? 'Max' : 'Pro'}; redeem at ${config.PUBLIC_WEB_URL}/billing)`, dedupeKey: `gift:${sessionId}` });
    }
    return code;
  },
  async redeemGift(accountId: string, code: string) {
    const current = await entitlementsRepo.get(accountId);
    if (current?.stripeSubscriptionId && effectiveTier(current) !== 'free' && current.status !== 'canceled') {
      throw new ConflictError('already_subscribed', 'You already have a paid plan; cancel it first or pass the code to a friend');
    }
    const rows = (await db.execute(sql`
      update gift_codes set redeemed_by = ${accountId}, redeemed_at = now()
      where code_hash = ${sha256(normGift(code))} and redeemed_at is null and expires_at > now()
      returning tier, months`)) as unknown as { tier: string; months: number }[];
    const g = rows[0];
    if (!g) throw new NotFoundError('gift code');
    // Stack on any remaining gift/comp time of the same tier
    const base = current && (current.status === 'gift' || current.status === 'comp') && current.tier === g.tier && current.currentPeriodEnd && current.currentPeriodEnd > new Date() ? current.currentPeriodEnd : new Date();
    const end = new Date(base.getTime() + g.months * 30 * DAY);
    await entitlementsRepo.upsert(accountId, { tier: g.tier, status: 'gift', currentPeriodEnd: end, cancelAtPeriodEnd: true, graceUntil: null });
    await audit.log('user', 'gift.redeemed', accountId, { tier: g.tier });
    return entitlementsService.describe(accountId);
  },

  // ------------------------------------------------------------ admin
  async adminUser(q: string) {
    const u = await platformRepo.userByUuidOrName(q);
    if (!u) throw new NotFoundError('user');
    return u;
  },
  async adminOverride(accountId: string, tier: Tier, days: number) {
    await entitlementsRepo.upsert(accountId, tier === 'free' ? { tier: 'free', status: 'none', currentPeriodEnd: null } : { tier, status: 'comp', currentPeriodEnd: new Date(Date.now() + days * DAY), cancelAtPeriodEnd: true });
    await audit.log('admin', 'entitlement.override', accountId, { tier, days });
    return entitlementsService.describe(accountId);
  },
  async adminBan(accountId: string, banned: boolean, reason: string) {
    await platformRepo.ban(accountId, banned);
    await audit.log('admin', banned ? 'account.banned' : 'account.unbanned', accountId, { reason });
  },

  // ------------------------------------------------------------ job health
  async checkJobs() {
    const now = Date.now();
    const late = (await platformRepo.jobs()).filter((j) => j.expectedEveryMinutes && (!j.lastOkAt || now - j.lastOkAt.getTime() > 3 * j.expectedEveryMinutes * 60_000));
    for (const j of late) logger.warn({ job: j.name, lastOkAt: j.lastOkAt, lastError: j.lastError }, 'job missed its window');
    return late.length;
  },
  async jobHealth() {
    const now = Date.now();
    return (await platformRepo.jobs()).map((j) => ({
      ...j,
      late: Boolean(j.expectedEveryMinutes && (!j.lastOkAt || now - j.lastOkAt.getTime() > 3 * j.expectedEveryMinutes * 60_000)),
    }));
  },
};

function toWebhookDto(w: { id: string; url: string; active: boolean; failures: number; lastStatus: number | null; lastDeliveryAt: Date | null; createdAt: Date }) {
  return { id: w.id, url: w.url, active: w.active, failures: w.failures, lastStatus: w.lastStatus, lastDeliveryAt: w.lastDeliveryAt, createdAt: w.createdAt };
}

