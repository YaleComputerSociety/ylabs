/**
 * URL construction utilities for API endpoints.
 */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export const safeUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return SAFE_URL_SCHEMES.has(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
};

export const ensureHttpPrefix = (url: string): string => safeUrl(url);
