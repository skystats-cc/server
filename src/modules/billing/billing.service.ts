import { config } from '../../lib/config.js';
import { ConflictError, UnavailableError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { audit } from '../audit/audit.repo.js';
import { entitlementsRepo } from '../entitlements/entitlements.repo.js';
import { effectiveTier, type Tier } from '../entitlements/tiers.js';
import { billingRepo } from './billing.repo.js';
import { stripeRequest } from './stripe.js';

const DAY = 86_400_000;

export function tierForPrice(priceId: string | undefined): Tier | null {
  if (!priceId) return null;
  if (config.STRIPE_PRICES_MAX.includes(priceId)) return 'max';
  if (config.STRIPE_PRICES_PRO.includes(priceId)) return 'pro';
  return null;
}

// The subset of Stripe objects we read
interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}
interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export const billingService = {
  /**
   * Stripe Checkout for a subscription. UK consumer law: the customer must agree to the terms,
   * which say the service starts immediately and they can cancel within 14 days for a refund.
   */
  async checkout(accountId: string, tier: 'pro' | 'max', interval: 'month' | 'year') {
    const prices = tier === 'max' ? config.STRIPE_PRICES_MAX : config.STRIPE_PRICES_PRO;
    const price = interval === 'year' ? prices[1] : prices[0];
    if (!price) throw new ConflictError('price_not_configured', `No ${interval}ly price for ${tier}`);
    const current = await entitlementsRepo.get(accountId);
    if (effectiveTier(current) !== 'free' && current?.stripeSubscriptionId) {
      throw new ConflictError('already_subscribed', 'Change plan from the billing portal');
    }
    const params: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: accountId,
      'subscription_data[metadata][accountId]': accountId,
      success_url: `${config.PUBLIC_WEB_URL}/billing?checkout=success`,
      cancel_url: `${config.PUBLIC_WEB_URL}/pricing`,
      'consent_collection[terms_of_service]': 'required',
      'custom_text[terms_of_service_acceptance][message]':
        'Your plan starts straight away. You can cancel any time, and within 14 days of buying for a full refund. Prices include VAT.',
      'automatic_tax[enabled]': 'true',
    };
    if (current?.stripeCustomerId) params.customer = current.stripeCustomerId;
    const session = await stripeRequest<{ url: string }>('POST', '/checkout/sessions', params);
    await audit.log('user', 'billing.checkout_started', accountId, { tier, interval });
    return { url: session.url };
  },

  /** Stripe's customer portal: cancel, change plan, invoices. Cancelling is as easy as signing up. */
  async portal(accountId: string) {
    const e = await entitlementsRepo.get(accountId);
    if (!e?.stripeCustomerId) throw new ConflictError('no_customer', 'No billing account yet');
    const s = await stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', {
      customer: e.stripeCustomerId,
      return_url: `${config.PUBLIC_WEB_URL}/billing`,
    });
    return { url: s.url };
  },

  /** Before erasure: stop billing straight away so nobody pays for a deleted account. */
  async cancelForErasure(accountId: string) {
    const e = await entitlementsRepo.get(accountId);
    if (!e?.stripeSubscriptionId || e.status === 'canceled') return;
    // Never erase an account while its subscription can still charge the customer
    if (!config.STRIPE_SECRET_KEY) throw new UnavailableError('Billing is unavailable; try deleting again later');
    await stripeRequest('DELETE', `/subscriptions/${e.stripeSubscriptionId}`);
    await audit.log('system', 'billing.canceled_for_erasure', accountId);
  },

  /** Idempotent webhook handler. Returns false when the event was already processed. */
  async handleEvent(event: StripeEvent) {
    if (!(await billingRepo.markEvent(event.id, event.type))) return false;
    const o = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const accountId = o.client_reference_id as string | undefined;
        const customer = o.customer as string | undefined;
        if (accountId && customer) await entitlementsRepo.upsert(accountId, { stripeCustomerId: customer });
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await this.applySubscription(o as unknown as StripeSubscription, event.type.endsWith('deleted'));
        break;
      }
      case 'invoice.payment_failed': {
        const e = await entitlementsRepo.byCustomer(o.customer as string);
        if (e) {
          await entitlementsRepo.upsert(e.accountId, {
            status: 'past_due',
            graceUntil: new Date(Date.now() + config.BILLING_GRACE_DAYS * DAY),
          });
          await audit.log('stripe', 'billing.payment_failed', e.accountId);
        }
        break;
      }
      default:
        logger.debug({ type: event.type }, 'stripe event ignored');
    }
    return true;
  },

  async applySubscription(sub: StripeSubscription, deleted: boolean) {
    const existing = await entitlementsRepo.byCustomer(sub.customer);
    const accountId = sub.metadata?.accountId ?? existing?.accountId;
    if (!accountId) return logger.warn({ sub: sub.id }, 'subscription without an account');

    const item = sub.items?.data?.[0];
    const tier = tierForPrice(item?.price?.id) ?? (existing?.tier as Tier | undefined) ?? 'free';
    const periodEnd = sub.current_period_end ?? item?.current_period_end;
    const status = deleted ? 'canceled' : sub.status;
    const wasPaid = existing ? effectiveTier(existing) !== 'free' : false;

    await entitlementsRepo.upsert(accountId, {
      tier,
      status,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      graceUntil: status === 'active' ? null : (existing?.graceUntil ?? null),
      // Start the soft-retention window when paid access ends
      downgradedAt: deleted && wasPaid ? new Date(periodEnd ? periodEnd * 1000 : Date.now()) : status === 'active' ? null : (existing?.downgradedAt ?? null),
    });
    await audit.log('stripe', 'billing.subscription_changed', accountId, { tier, status });
  },
};
