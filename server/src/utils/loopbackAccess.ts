/**
 * Loopback predicates for development-only affordances.
 *
 * A development affordance is scoped to the developer's own machine, so the
 * question these answer is "did this request arrive over the loopback
 * interface", never "is this runtime labelled development".
 */
import type { Request } from 'express';
import { isIP } from 'node:net';

const MAX_HOST_HEADER_LENGTH = 255;
const IPV4_MAPPED_IPV6_PREFIX = '::ffff:';
const UNSAFE_HOST_HEADER_CHARACTER = /[/\\?#@\s]/;

const withoutIpv6Brackets = (value: string): string => value.replace(/^\[/, '').replace(/\]$/, '');

export const isLoopbackAddress = (value: string | undefined): boolean => {
  const address = withoutIpv6Brackets(String(value ?? '').trim()).toLowerCase();
  if (!address) return false;
  if (address === '::1') return true;

  const ipv4 = address.startsWith(IPV4_MAPPED_IPV6_PREFIX)
    ? address.slice(IPV4_MAPPED_IPV6_PREFIX.length)
    : address;
  return isIP(ipv4) === 4 && ipv4.split('.')[0] === '127';
};

export const isLoopbackHostname = (value: string | undefined): boolean => {
  const hostname = withoutIpv6Brackets(String(value ?? '').trim())
    .toLowerCase()
    .replace(/\.$/, '');
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  return isLoopbackAddress(hostname);
};

export const isLoopbackHostHeader = (value: string | string[] | undefined): boolean => {
  const raw = (Array.isArray(value) ? value[0] : value) ?? '';
  const host = raw.trim();
  if (!host || host.length > MAX_HOST_HEADER_LENGTH) return false;
  if (UNSAFE_HOST_HEADER_CHARACTER.test(host)) return false;

  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
};

export const isLoopbackHttpOrigin = (value: string | undefined): boolean => {
  const origin = String(value ?? '').trim();
  if (!origin) return false;

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Reads the socket peer rather than `req.ip`, because `req.ip` can be resolved
 * from a forwarded header and this predicate is about the connection itself.
 */
export const isLoopbackRequest = (req: Pick<Request, 'headers' | 'socket'>): boolean =>
  isLoopbackAddress(req.socket?.remoteAddress) && isLoopbackHostHeader(req.headers?.host);
