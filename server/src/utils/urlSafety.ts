export const MAX_PUBLIC_HTTP_URL_LENGTH = 2048;
const UNSAFE_RAW_PUBLIC_URL_CHAR_RE = /[\u0000-\u0020\u007f\\]/;
const PRIVATE_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const PRIVATE_HOSTNAME_SUFFIXES = ['.local', '.internal', '.lan', '.home.arpa', '.localdomain'];

const stripIpv6Brackets = (value: string): string => value.replace(/^\[/, '').replace(/\]$/, '');

const ipv4ToNumber = (addr: string): number | null => {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr)) return null;
  const parts = addr.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
};

const isIpv4InCidr = (addr: string, base: string, prefix: number): boolean => {
  const value = ipv4ToNumber(addr);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
};

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const clean = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, '');
  if (!clean) return true;
  if (clean === 'localhost' || clean.endsWith('.localhost')) return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => clean.endsWith(suffix))) return true;
  if (!clean.includes('.') && !clean.includes(':')) return true;
  if (clean.includes(':')) return true;
  return PRIVATE_IPV4_CIDRS.some(([base, prefix]) => isIpv4InCidr(clean, base, prefix));
}

export function isAllowedPublicHttpPort(url: URL): boolean {
  return (
    !url.port ||
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  );
}

export function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_PUBLIC_HTTP_URL_LENGTH) return false;
  if (UNSAFE_RAW_PUBLIC_URL_CHAR_RE.test(trimmed)) return false;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (isPrivateOrLocalHostname(url.hostname)) return false;
    if (!isAllowedPublicHttpPort(url)) return false;
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function publicHttpUrl(value: unknown): string | undefined {
  if (!isPublicHttpUrl(value)) return undefined;
  return new URL((value as string).trim()).toString();
}
