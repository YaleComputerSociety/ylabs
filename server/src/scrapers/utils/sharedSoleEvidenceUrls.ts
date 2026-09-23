/**
 * A URL that is the SOLE evidence for more than one research entity.
 *
 * Such a page cannot be describing any of the rows that cite it. A school's
 * site-wide research landing page, or a shared core-facility page, reads as
 * perfectly good research prose, so no output-side check on the text can tell it
 * apart from a lab's own homepage - and the description lane will happily stamp
 * the identical body onto every row whose single citation it is. Measured on
 * Development over the description-empty cohort, one school-level landing page was
 * the sole evidence for three rows, one of them in a different school (#3148).
 *
 * The signal is deliberately evidence-shaped rather than text-shaped, and it is
 * decidable before a page is fetched or a token is spent.
 *
 * "Sole" is load-bearing in both directions.
 * - A row citing a shared page ALONGSIDE its own lab site is not described by the
 *   shared page either, but this module must not refuse the shared URL for it,
 *   because the lane will reach the better URL on its own and a refusal here would
 *   cost nothing and prove nothing.
 * - A shared page cited by one row only is that row's best available evidence, and
 *   many legitimately branded centres and institutes are cited by exactly one row.
 *   Refusing on "shared host" or "looks institutional" instead is what withheld
 *   real centres in #2570.
 */

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Compared with the query string and fragment dropped and the trailing slash
 * normalized, because a CMS serves the same landing page under both
 * `/research` and `/research/`, and a tracking query would otherwise make two
 * citations of one page look like two pages.
 */
export function normalizeEvidenceUrl(value: unknown): string {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.hostname.replace(/^www\./i, '').toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return '';
  }
}

export interface EvidenceCitingRow {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}

/** Every distinct URL a row offers as evidence, normalized. */
export function evidenceUrlsOf(row: EvidenceCitingRow): string[] {
  const candidates = [
    row.websiteUrl,
    row.website,
    ...(Array.isArray(row.sourceUrls) ? row.sourceUrls : []),
  ];
  return Array.from(new Set(candidates.map(normalizeEvidenceUrl).filter(Boolean)));
}

/**
 * The URLs that are the only evidence more than one row has.
 *
 * Counted over rows rather than over citations, so a single row listing the same
 * page twice never makes it look shared.
 */
export function sharedSoleEvidenceUrls(rows: readonly EvidenceCitingRow[]): Set<string> {
  const soleEvidenceHolders = new Map<string, number>();
  for (const row of rows) {
    const urls = evidenceUrlsOf(row);
    if (urls.length !== 1) continue;
    const url = urls[0];
    soleEvidenceHolders.set(url, (soleEvidenceHolders.get(url) || 0) + 1);
  }
  return new Set(
    [...soleEvidenceHolders.entries()].filter(([, holders]) => holders > 1).map(([url]) => url),
  );
}

export function isSharedSoleEvidenceUrl(value: unknown, shared: ReadonlySet<string>): boolean {
  const normalized = normalizeEvidenceUrl(value);
  return normalized.length > 0 && shared.has(normalized);
}
