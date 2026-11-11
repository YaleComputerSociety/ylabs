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

/**
 * Every spelling a lane can store one page under: either scheme, with or without `www.`,
 * and with or without a trailing slash. Equality on these lets an exact `$in` stay indexed
 * where a case-insensitive regex would not.
 */
export function officialProfileUrlSpellings(url: string): string[] {
  const spellings = new Set([url]);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [...spellings];
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '');
  for (const scheme of ['https:', 'http:']) {
    for (const prefix of ['', 'www.']) {
      for (const slash of ['', '/']) {
        spellings.add(`${scheme}//${prefix}${host}${path}${slash}${parsed.search}`);
      }
    }
  }
  return [...spellings];
}
