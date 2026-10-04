/**
 * Compared with `.toLowerCase()` on both sides, so `Https://WWW.Host/Path/` and
 * `https://host/path` are one identity. Query and fragment are dropped: a Yale
 * person page serves the same person with or without a tracking parameter.
 */
export function officialProfileIdentityUrlKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '').toLowerCase();
    return pathname ? `${host}${pathname}` : '';
  } catch {
    return '';
  }
}
