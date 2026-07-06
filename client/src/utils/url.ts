/**
 * URL construction utilities for API endpoints.
 */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const UNSAFE_RAW_URL_CHAR_RE = /[\u0000-\u0020\u007f\\]/;
const EMAIL_ADDRESS_PATTERN =
  /^[a-z0-9.!#$&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DOI_PATTERN = /^10\.\d{4,9}\/[a-z0-9._;()/:+-]+$/i;
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
export const MAX_SAFE_URL_LENGTH = 2048;
export const MAX_SAFE_EMAIL_LENGTH = 254;
export const MAX_SAFE_DOI_LENGTH = 512;
export const MAX_SAFE_MAILTO_SUBJECT_LENGTH = 200;
export const MAX_SAFE_MAILTO_BODY_LENGTH = 2000;
export const MAX_SAFE_URL_LIST_ITEMS = 50;
export const MAX_SAFE_ROUTE_SEGMENT_LENGTH = 200;
export const EXTERNAL_LINK_REL = 'noopener noreferrer';
export const EXTERNAL_IMAGE_REFERRER_POLICY = 'no-referrer';
export const NEW_TAB_WINDOW_FEATURES = 'noopener,noreferrer';

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

const isPrivateOrLocalHostname = (hostname: string): boolean => {
  const clean = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, '');
  if (!clean) return true;
  if (clean === 'localhost' || clean.endsWith('.localhost')) return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => clean.endsWith(suffix))) return true;
  if (!clean.includes('.') && !clean.includes(':')) return true;
  if (clean.includes(':')) return true;
  return PRIVATE_IPV4_CIDRS.some(([base, prefix]) => isIpv4InCidr(clean, base, prefix));
};

const isAllowedPublicHttpPort = (url: URL): boolean =>
  !url.port ||
  (url.protocol === 'http:' && url.port === '80') ||
  (url.protocol === 'https:' && url.port === '443');

const safeEmailAddress = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_SAFE_EMAIL_LENGTH) return '';

  const withoutMailto = trimmed.replace(/^mailto:/i, '');
  if (withoutMailto.length > MAX_SAFE_EMAIL_LENGTH) return '';
  if (
    /[\s,;<>()[\]"\\]/.test(withoutMailto) ||
    /[?#&]/.test(withoutMailto) ||
    /%0a|%0d/i.test(withoutMailto)
  ) {
    return '';
  }

  return EMAIL_ADDRESS_PATTERN.test(withoutMailto) ? withoutMailto.toLowerCase() : '';
};

export const safeUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_SAFE_URL_LENGTH) return '';
  if (UNSAFE_RAW_URL_CHAR_RE.test(trimmed)) return '';
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol === 'mailto:') {
      const email = safeEmailAddress(trimmed);
      return email ? `mailto:${email}` : '';
    }
    if (parsed.username || parsed.password) return '';
    if (isPrivateOrLocalHostname(parsed.hostname)) return '';
    if (!isAllowedPublicHttpPort(parsed)) return '';
    return SAFE_URL_SCHEMES.has(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
};

export const safeHttpUrl = (raw: unknown): string => {
  const href = safeUrl(raw);
  if (!href) return '';

  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? href : '';
  } catch {
    return '';
  }
};

export const safeImageSrc = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_SAFE_URL_LENGTH) return '';

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    if (/[\u0000-\u001f\u007f<>`"\\]/.test(trimmed)) return '';
    return trimmed;
  }

  return safeHttpUrl(trimmed);
};

export const ensureHttpPrefix = (url: string): string => safeHttpUrl(url);

const safeUrlListValues = (values: unknown): unknown[] =>
  Array.isArray(values) ? values.slice(0, MAX_SAFE_URL_LIST_ITEMS) : [];

export const safeUrlList = (values: unknown): string[] =>
  Array.from(new Set(safeUrlListValues(values).map((value) => safeUrl(value)).filter(Boolean)));

export const safeHttpUrlList = (values: unknown): string[] =>
  Array.from(new Set(safeUrlListValues(values).map((value) => safeHttpUrl(value)).filter(Boolean)));

export const safeRouteSegment = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_ROUTE_SEGMENT_LENGTH) return '';
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '';
  if (trimmed === '.' || trimmed === '..') return '';
  if (/^%(?:2e)(?:%(?:2e))?$/i.test(trimmed)) return '';
  return encodeURIComponent(trimmed);
};

export const safeMailtoHref = (
  rawEmail: unknown,
  params: { subject?: string; body?: string } = {},
): string => {
  const email = safeEmailAddress(rawEmail);
  if (!email) return '';

  const query = new URLSearchParams();
  if (typeof params.subject === 'string' && params.subject.length <= MAX_SAFE_MAILTO_SUBJECT_LENGTH) {
    query.set('subject', params.subject);
  }
  if (typeof params.body === 'string' && params.body.length <= MAX_SAFE_MAILTO_BODY_LENGTH) {
    query.set('body', params.body);
  }

  const encodedQuery = query.toString();
  return encodedQuery ? `mailto:${email}?${encodedQuery}` : `mailto:${email}`;
};

export const safeDoiUrl = (rawDoi: unknown): string => {
  if (typeof rawDoi !== 'string') return '';
  if (rawDoi.trim().length > MAX_SAFE_DOI_LENGTH) return '';
  const doi = rawDoi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  if (!doi || /[\s<>"'\\%?#]/.test(doi)) return '';
  return DOI_PATTERN.test(doi) ? `https://doi.org/${doi}` : '';
};

export const openSafeUrlInNewTab = (raw: unknown): Window | null => {
  const href = safeHttpUrl(raw);
  if (!href) return null;

  const opened = window.open(href, '_blank', NEW_TAB_WINDOW_FEATURES);
  if (opened) opened.opener = null;
  return opened;
};
