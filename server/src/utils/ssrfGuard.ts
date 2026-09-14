/**
 * Shared SSRF protection: classify IPs/hostnames as private vs public, a connect-time DNS lookup
 * that blocks private resolutions (defeats DNS rebinding / TOCTOU), and helpers for guarding
 * outbound HTTP. This is the single source of truth used by both the admin URL checker and the
 * scrapers — any outbound fetch to a host derived from user input or stored data must go through it.
 */
import net from 'net';
import type { LookupAddress } from 'dns';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import type { LookupFunction } from 'net';
import { containsAsciiControl } from './asciiControl';

const MAX_SSRF_PUBLIC_HTTP_URL_LENGTH = 2048;
const hasUnsafePublicHttpUrlCharacter = (value: string): boolean =>
  containsAsciiControl(value) || /[\s\\]/.test(value);

export const stripIpv6Brackets = (addr: string): string =>
  addr.replace(/^\[/, '').replace(/\]$/, '');

const ipv4ToNumber = (addr: string): number | null => {
  if (net.isIP(addr) !== 4) return null;
  const parts = addr.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
};

const isIpv4InCidr = (addr: string, base: string, prefix: number): boolean => {
  const value = ipv4ToNumber(addr);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
};

const parseIpv6ToBigInt = (addr: string): bigint | null => {
  const clean = stripIpv6Brackets(addr).toLowerCase();
  if (net.isIP(clean) !== 6) return null;

  const parts = clean.split('::');
  if (parts.length > 2) return null;

  const expandDottedQuad = (segments: string[]): string[] | null => {
    const dottedIndex = segments.findIndex((segment) => segment.includes('.'));
    if (dottedIndex === -1) return segments;
    if (dottedIndex !== segments.length - 1) return null;

    const value = ipv4ToNumber(segments[dottedIndex]);
    if (value === null) return null;

    return [
      ...segments.slice(0, -1),
      ((value >>> 16) & 0xffff).toString(16),
      (value & 0xffff).toString(16),
    ];
  };

  const left = expandDottedQuad(parts[0] ? parts[0].split(':') : []);
  const right = expandDottedQuad(parts[1] ? parts[1].split(':') : []);
  if (!left || !right) return null;

  const hasCompression = parts.length === 2;
  const missing = hasCompression ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;

  const segments = hasCompression ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (segments.length !== 8) return null;

  let result = 0n;
  for (const segment of segments) {
    if (!/^[0-9a-f]{1,4}$/.test(segment)) return null;
    result = (result << 16n) + BigInt(parseInt(segment, 16));
  }
  return result;
};

const isIpv6InCidr = (addr: string, base: string, prefix: number): boolean => {
  const value = parseIpv6ToBigInt(addr);
  const baseValue = parseIpv6ToBigInt(base);
  if (value === null || baseValue === null) return false;
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return value >> shift === baseValue >> shift;
};

export const isPrivateAddress = (addr: string): boolean => {
  const clean = stripIpv6Brackets(addr);
  const family = net.isIP(clean);
  if (family === 0) return true;
  if (family === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, prefix]) => isIpv4InCidr(clean, String(base), Number(prefix)));
  }
  return [
    ['::', 128],
    ['::1', 128],
    ['::ffff:0:0', 96],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 32],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ].some(([base, prefix]) => isIpv6InCidr(clean, String(base), Number(prefix)));
};

/**
 * Why a hostname is not usable, not merely that it is not. Callers that only need
 * a yes/no keep using `isPublicHostname`; callers that must tell a name which no
 * longer exists from one we refuse to reach need the distinction, because those
 * are opposite facts: the first is about the resource, the second about us.
 */
export type HostnameResolution =
  | { kind: 'public' }
  | { kind: 'private-address' }
  | { kind: 'unresolvable' }
  | { kind: 'resolver-failure' };

/**
 * Only NXDOMAIN and NODATA even claim that a name has no record. Every other
 * lookup failure (SERVFAIL, a timeout, `EAI_AGAIN`) is our resolver having a bad
 * moment and must stay inconclusive, or a DNS blip would retire live citations.
 */
const NAME_DOES_NOT_EXIST_DNS_CODES = new Set(['ENOTFOUND', 'ENODATA']);

const NAME_LOOKUP_RETRY_DELAY_MS = 250;

const nameDoesNotExist = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && NAME_DOES_NOT_EXIST_DNS_CODES.has(code);
};

const classifyLookupResult = (records: LookupAddress[]): HostnameResolution => {
  if (records.length === 0) return { kind: 'unresolvable' };
  return records.every((r) => !isPrivateAddress(r.address))
    ? { kind: 'public' }
    : { kind: 'private-address' };
};

/**
 * `unresolvable` is the only verdict a caller may act on destructively, so it is
 * the only one that has to be confirmed. Node reports `ENOTFOUND` for names that
 * plainly exist when the resolver is under stress, observed on a live Atlas shard
 * host that resolved both before and after the report. A false `unresolvable`
 * suppresses a correct citation from a student; a false `resolver-failure` only
 * defers the verdict to the next probe. So a claimed negative is asked again and
 * only a second agreeing answer records it (#2725, the same reasoning as the
 * #2473 transport retry in `probeSourceLink`).
 */
export const classifyHostnameResolution = async (
  hostname: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<HostnameResolution> => {
  const clean = stripIpv6Brackets(hostname);
  if (net.isIP(clean)) {
    return isPrivateAddress(clean) ? { kind: 'private-address' } : { kind: 'public' };
  }

  try {
    const first = classifyLookupResult(await dns.lookup(clean, { all: true }));
    if (first.kind !== 'unresolvable') return first;
  } catch (error) {
    if (!nameDoesNotExist(error)) return { kind: 'resolver-failure' };
  }

  await sleep(NAME_LOOKUP_RETRY_DELAY_MS);
  try {
    return classifyLookupResult(await dns.lookup(clean, { all: true }));
  } catch (error) {
    return nameDoesNotExist(error) ? { kind: 'unresolvable' } : { kind: 'resolver-failure' };
  }
};

export const isPublicHostname = async (hostname: string): Promise<boolean> =>
  (await classifyHostnameResolution(hostname)).kind === 'public';

export const ssrfSafeLookup: LookupFunction = (hostname, options, callback) => {
  dns
    .lookup(stripIpv6Brackets(hostname), options)
    .then((result) => {
      const records = Array.isArray(result) ? result : [result];
      if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
        const err = new Error('Blocked private or non-public address') as NodeJS.ErrnoException;
        err.code = 'EHOSTUNREACH';
        callback(err, '', 0);
        return;
      }

      if (Array.isArray(result)) {
        callback(null, result);
        return;
      }
      callback(null, result.address, result.family);
    })
    .catch((error) => callback(error as NodeJS.ErrnoException, '', 0));
};

export type SsrfBlockedReason =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'credentials'
  | 'port'
  | 'private-address'
  | 'unresolvable'
  | 'resolver-failure';

export class SsrfBlockedError extends Error {
  readonly reason: SsrfBlockedReason;

  constructor(message = 'Blocked by SSRF guard', reason: SsrfBlockedReason = 'invalid-url') {
    super(message);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
    Object.setPrototypeOf(this, SsrfBlockedError.prototype);
  }
}

const isAllowedPublicHttpPort = (url: URL): boolean =>
  !url.port ||
  (url.protocol === 'http:' && url.port === '80') ||
  (url.protocol === 'https:' && url.port === '443');

/**
 * Validate an outbound URL before fetching: must be http(s), carry no embedded credentials, and
 * resolve to a public address. Throws SsrfBlockedError otherwise. Pair with ssrfSafeAgents() so
 * redirect hops are re-validated at connect time.
 */
export const assertPublicHttpUrl = async (rawUrl: string): Promise<URL> => {
  if (typeof rawUrl !== 'string') {
    throw new SsrfBlockedError('Invalid URL', 'invalid-url');
  }

  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_SSRF_PUBLIC_HTTP_URL_LENGTH) {
    throw new SsrfBlockedError('Invalid URL', 'invalid-url');
  }
  if (hasUnsafePublicHttpUrlCharacter(trimmed)) {
    throw new SsrfBlockedError('Invalid URL', 'invalid-url');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SsrfBlockedError('Invalid URL', 'invalid-url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('Unsupported URL scheme', 'unsupported-scheme');
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError('URL credentials are not allowed', 'credentials');
  }
  if (!isAllowedPublicHttpPort(parsed)) {
    throw new SsrfBlockedError('URL port is not allowed', 'port');
  }
  const resolution = await classifyHostnameResolution(parsed.hostname);
  if (resolution.kind !== 'public') {
    throw new SsrfBlockedError('URL resolves to a private or non-public address', resolution.kind);
  }
  return parsed;
};

/** axios/http agents whose DNS resolution blocks private addresses on every (redirect) hop. */
export const ssrfSafeAgents = (): {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
} => ({
  httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
  httpsAgent: new https.Agent({ lookup: ssrfSafeLookup }),
});
