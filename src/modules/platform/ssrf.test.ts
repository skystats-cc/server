import { describe, expect, it } from 'vitest';
import { assertPublicHttpsUrl, isPrivateAddress } from './ssrf.js';

describe('webhook URL guard', () => {
  it('spots private addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });
  it('rejects bad URLs without network lookups', async () => {
    await expect(assertPublicHttpsUrl('http://example.com/hook')).rejects.toThrow('https');
    await expect(assertPublicHttpsUrl('https://127.0.0.1/hook')).rejects.toThrow('not public');
    await expect(assertPublicHttpsUrl('https://api.localhost/x')).rejects.toThrow('not public');
    await expect(assertPublicHttpsUrl('https://u:p@example.com/')).rejects.toThrow('credentials');
    await expect(assertPublicHttpsUrl('https://example.com:8443/')).rejects.toThrow('port');
    await expect(assertPublicHttpsUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });
});
