/**
 * A URL cited by more than one research entity.
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
 * Counted over every citation rather than only over rows whose citation is their
 * SOLE one. That narrower rule was built first and measured: it left two rows still
 * receiving one school landing page's blurb, because the lane picks the umbrella URL
 * whether or not the row also cites something else, so "the row has another citation"
 * does not mean the lane reached it.
 *
 * Sharing alone cannot decide it, because a person's own profile page is cited by
 * both their `LAB` and their `FACULTY_RESEARCH_AREA` row and genuinely describes
 * both. The caller therefore exempts a person page, which has already been name
 * matched to the entity upstream. What is left is the institutional shape: a landing
 * page, a section index, a programme page, a shared core facility.
 *
 * A page cited by exactly one row is that row's best available evidence, and many
 * legitimately branded centres and institutes are cited by exactly one row. Refusing
 * on "shared host" or "looks institutional" instead is what withheld real centres in
 * #2570.
 */

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
 * The URLs more than one row cites.
 *
 * Counted over rows rather than over citations, so a single row listing the same
 * page twice never makes it look shared.
 */
export function sharedEvidenceUrls(rows: readonly EvidenceCitingRow[]): Set<string> {
  const holders = new Map<string, number>();
  for (const row of rows) {
    for (const url of evidenceUrlsOf(row)) {
      holders.set(url, (holders.get(url) || 0) + 1);
    }
  }
  return new Set([...holders.entries()].filter(([, count]) => count > 1).map(([url]) => url));
}

export function isSharedEvidenceUrl(value: unknown, shared: ReadonlySet<string>): boolean {
  const normalized = normalizeEvidenceUrl(value);
  return normalized.length > 0 && shared.has(normalized);
}

/**
 * Hosts that serve many rows' evidence, which is what makes them institutional: a
 * school or department site carries hundreds of people, a lab microsite carries one.
 *
 * Derived from the corpus rather than from a host allowlist, because the two shapes
 * are not distinguishable by name. `proberlab.yale.edu` is a `yale.edu` subdomain and
 * a single lab's site; `tu-lab.org` is off-campus and also a single lab's site; both
 * must stay in scope while `medicine.yale.edu` does not.
 */
export function institutionalEvidenceHosts(
  rows: readonly EvidenceCitingRow[],
  minRows = 25,
): Set<string> {
  const rowsPerHost = new Map<string, number>();
  for (const row of rows) {
    const hosts = new Set<string>();
    for (const url of evidenceUrlsOf(row)) {
      try {
        hosts.add(new URL(url).hostname);
      } catch {
        continue;
      }
    }
    for (const host of hosts) rowsPerHost.set(host, (rowsPerHost.get(host) || 0) + 1);
  }
  return new Set(
    [...rowsPerHost.entries()].filter(([, count]) => count >= minRows).map(([host]) => host),
  );
}

/**
 * Whole-organisation sections. A one-segment path naming one of these on an
 * institutional host is that organisation's own landing page, so its prose describes
 * the school and not the row the lane is reading it for.
 *
 * The one-segment bound is what keeps a real unit in scope: `medicine.yale.edu/
 * internal-medicine/genmed/eric/` is a named centre three segments deep, and
 * `medicine.yale.edu/research/` is the school's research landing page. The
 * institutional-host bound is what keeps a lab's own `/research` page in scope.
 */
const INSTITUTION_SECTION_SEGMENT =
  /^(?:research|about|about-us|education|patient-care|clinical-care|diversity|news|events|giving|departments|centers|centres|labs|faculty-research)$/i;

export function isInstitutionSectionLandingUrl(
  value: unknown,
  institutionalHosts: ReadonlySet<string>,
): boolean {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (!institutionalHosts.has(url.hostname)) return false;
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length === 1 && INSTITUTION_SECTION_SEGMENT.test(segments[0]);
  } catch {
    return false;
  }
}
