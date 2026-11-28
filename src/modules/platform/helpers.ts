import { createHmac, randomBytes } from 'node:crypto';

/** HMAC-SHA256 over "timestamp.body", sent as `t=<unix>,v1=<hex>` like Stripe, so receivers can reject replays */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

/** Human-friendly gift codes: 16 characters from an unambiguous alphabet */
export function newGiftCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
}

// "every 15 min" → 15, hourly → 60, daily → 1440, weekly → 10080; anything fancier → null
export function cronIntervalMinutes(cron: string): number | null {
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (!m || !h || dom !== '*' || mon !== '*') return null;
  const step = /^\*\/(\d+)$/.exec(m);
  if (step && h === '*' && dow === '*') return Number(step[1]);
  if (/^\d+$/.test(m) && h === '*' && dow === '*') return 60;
  if (/^\d+$/.test(m) && /^\d+$/.test(h)) return dow === '*' ? 1440 : 10080;
  return null;
}
