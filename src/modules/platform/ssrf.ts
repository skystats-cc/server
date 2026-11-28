import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Private, loopback, link-local and other non-public ranges */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Webhook URLs must be https on a public host, so nobody can make the server call our own network. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new Error('Webhook URLs must use https');
  if (url.username || url.password) throw new Error('No credentials in the URL');
  if (url.port && url.port !== '443') throw new Error('Only the default https port is allowed');
  const host = url.hostname;
  if (isIP(host) ? isPrivateAddress(host) : /(^|\.)(localhost|local|internal|lan|home)$/i.test(host)) throw new Error('That host is not public');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('That host is not public');
  return url;
}
