import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Minecraft UUIDs are stored without dashes, lowercase (same as Hypixel profile member keys). */
export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}
export const UUID_RE = /^[0-9a-f]{32}$/;

/** Opaque bearer token, e.g. ssm_x8F... (stored only as a SHA-256 hash) */
export function newToken(prefix: 'ssm' | 'ssw'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two strings (e.g. shared secrets) */
export function safeEqualText(a: string, b: string): boolean {
  const ab = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ab, bb) && a.length === b.length;
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// No 0/O/1/I to avoid misreading. 32^8 ≈ 1.1e12 combinations.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;

export function newPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** "abcd efgh" / "ABCD-EFGH" -> "ABCDEFGH"; null if it can't be a valid code */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** 40 hex chars, the same shape as the serverId hash a real server sends */
export function newServerId(): string {
  return randomBytes(20).toString('hex');
}
