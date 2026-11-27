import { config } from '../../lib/config.js';
import { UnavailableError, UpstreamError } from '../../lib/errors.js';

/** Minimal Stripe REST client (form-encoded), so we don't need the SDK for three calls. */
export async function stripeRequest<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string> = {}) {
  if (!config.STRIPE_SECRET_KEY) throw new UnavailableError('Billing is not configured');
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : body,
  });
  if (!res.ok) throw new UpstreamError(res.status, `stripe ${path}`);
  return (await res.json()) as T;
}
