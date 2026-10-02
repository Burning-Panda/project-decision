import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast/reserved and unparseable addresses. */
export function isPrivateAddress(address) {
  const ip = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) {
    const rest = ip.slice(7);
    if (rest.includes('.')) return isPrivateAddress(rest);
    const hex = rest.split(':');
    if (hex.length === 2) {
      const n = (Number.parseInt(hex[0], 16) * 65536) + Number.parseInt(hex[1], 16);
      return isPrivateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return true;
  }
  if (ip.includes(':')) return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && p[2] === 0);
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan'];

/** Returns the normalised URL or throws Error(message). Private targets are rejected unless allowPrivate. */
export function validateWebhookUrl(raw, allowPrivate = false) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('url is not a valid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('url must be http or https');
  if (u.username || u.password) throw new Error('url must not contain credentials');
  if (!allowPrivate) {
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) throw new Error('url must not point at an internal host');
    if (net.isIP(host) && isPrivateAddress(host)) throw new Error('url must not point at a private address');
  }
  return u.href;
}
