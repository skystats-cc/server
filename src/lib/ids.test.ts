import { describe, expect, it } from 'vitest';
import {
  formatPairingCode,
  newPairingCode,
  newServerId,
  newToken,
  normalizePairingCode,
  normalizeUuid,
  safeEqualHex,
  sha256,
} from './ids.js';

describe('ids', () => {
  it('normalizes uuids', () => {
    expect(normalizeUuid('069A79F4-44E9-4726-A5BE-FCA90E38AAF5')).toBe('069a79f444e94726a5befca90e38aaf5');
  });

  it('generates and round-trips pairing codes', () => {
    for (let i = 0; i < 200; i++) {
      const code = newPairingCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
      expect(normalizePairingCode(formatPairingCode(code).toLowerCase())).toBe(code);
    }
  });

  it('rejects malformed codes', () => {
    expect(normalizePairingCode('ABCD-EFG')).toBeNull();
    expect(normalizePairingCode('ABCD-EFG0')).toBeNull(); // 0 not in alphabet
    expect(normalizePairingCode('')).toBeNull();
  });

  it('makes tokens and compares hashes safely', () => {
    const t = newToken('ssm');
    expect(t.startsWith('ssm_')).toBe(true);
    expect(safeEqualHex(sha256(t), sha256(t))).toBe(true);
    expect(safeEqualHex(sha256(t), sha256(t + 'x'))).toBe(false);
    expect(newServerId()).toMatch(/^[0-9a-f]{40}$/);
  });
});
