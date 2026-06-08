/**
 * URL construction utilities for API endpoints.
 */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const EMAIL_ADDRESS_PATTERN =
  /^[a-z0-9.!#$&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
export const EXTERNAL_LINK_REL = 'noopener noreferrer';
export const NEW_TAB_WINDOW_FEATURES = 'noopener,noreferrer';

const safeEmailAddress = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const withoutMailto = trimmed.replace(/^mailto:/i, '');
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
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol === 'mailto:') {
      const email = safeEmailAddress(trimmed);
      return email ? `mailto:${email}` : '';
    }
    if (parsed.username || parsed.password) return '';
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

export const ensureHttpPrefix = (url: string): string => safeHttpUrl(url);

export const safeUrlList = (values: unknown[]): string[] =>
  Array.from(new Set(values.map((value) => safeUrl(value)).filter(Boolean)));

export const safeHttpUrlList = (values: unknown[]): string[] =>
  Array.from(new Set(values.map((value) => safeHttpUrl(value)).filter(Boolean)));

export const safeMailtoHref = (
  rawEmail: unknown,
  params: { subject?: string; body?: string } = {},
): string => {
  const email = safeEmailAddress(rawEmail);
  if (!email) return '';

  const query = new URLSearchParams();
  if (params.subject) query.set('subject', params.subject);
  if (params.body) query.set('body', params.body);

  const encodedQuery = query.toString();
  return encodedQuery ? `mailto:${email}?${encodedQuery}` : `mailto:${email}`;
};

export const openSafeUrlInNewTab = (raw: unknown): Window | null => {
  const href = safeUrl(raw);
  if (!href) return null;

  const opened = window.open(href, '_blank', NEW_TAB_WINDOW_FEATURES);
  if (opened) opened.opener = null;
  return opened;
};
