import { isIPv4, isIPv6 } from 'node:net';

/**
 * Normalises a client address for throttling keys:
 *  - IPv4-mapped IPv6 (::ffff:1.2.3.4) becomes plain IPv4;
 *  - other IPv6 addresses collapse to their /64 prefix, because a single subscriber usually
 *    controls a whole /64 and could otherwise rotate addresses to dodge per-IP limits.
 */
export function normaliseIp(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const ip = raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0] as string;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && isIPv4(mapped[1] as string)) return mapped[1] as string;
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return ip;
  const groups = expandIPv6(ip);
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIPv6(ip: string): string[] {
  let address = ip.toLowerCase();
  // Embedded IPv4 tail (e.g. 64:ff9b::1.2.3.4) -> two hextets.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (v4) {
    const parts = (v4[1] as string).split('.').map(Number);
    const hex = [
      ((parts[0] as number) << 8) | (parts[1] as number),
      ((parts[2] as number) << 8) | (parts[3] as number),
    ];
    address = address.replace(v4[1] as string, hex.map((h) => h.toString(16)).join(':'));
  }
  const [head, tail] = address.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill =
    tail === undefined ? [] : Array.from({ length: 8 - left.length - right.length }, () => '0');
  return [...left, ...fill, ...right].map((g) => (parseInt(g || '0', 16) || 0).toString(16));
}
