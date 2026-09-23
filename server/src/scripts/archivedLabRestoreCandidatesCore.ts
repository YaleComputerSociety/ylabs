/**
 * The classification behind `research-entity:audit-archived-lab-restore-candidates` (#2558).
 *
 * This audit exists because the size of one claim has been re-derived wrong four
 * times: 48 URL-orphaned archived labs, then 39, then 77, then "about 5". Every
 * inflated reading came from the same substitution - counting rows whose
 * `websiteUrl` no live row happens to repeat, and calling that a lost lab. A URL
 * stops being repeated whenever a merge picks a better canonical one, so the proxy
 * fires hardest exactly where nothing was lost.
 *
 * The arms below are the disqualifications that measurement found, in order, so a
 * future reading starts from the narrowed number instead of the proxy. They are
 * ordered and disjoint: a row is reported under the first arm that disqualifies it,
 * and only a row that clears every arm is a restore candidate.
 */
export type ArchivedLabRestoreVerdict =
  | 'no_distinct_site'
  | 'institutional_root_site'
  | 'person_page_site'
  | 'site_served_by_live_row'
  | 'survives_under_canonical'
  | 'site_unreachable'
  | 'lead_cannot_host'
  | 'restore_candidate';

export const archivedLabRestoreVerdicts: readonly ArchivedLabRestoreVerdict[] = [
  'no_distinct_site',
  'institutional_root_site',
  'person_page_site',
  'site_served_by_live_row',
  'survives_under_canonical',
  'site_unreachable',
  'lead_cannot_host',
  'restore_candidate',
];

/**
 * The lane that #2877 landed: a lead too junior to admit a student is not a lead,
 * so the rows it archived are a decided product judgement rather than an accident.
 * Restoring one reverses that decision, which is a separate argument to make and
 * not something this audit should hide inside a candidate count.
 */
export const SUBORDINATE_RANK_ARCHIVE_REASON =
  'subordinate-research-rank-not-a-research-home-owner';

/**
 * Yale's own homepage, reached when a roster lane collapsed a nav link it could not
 * resolve (#2548). A row carrying it has no site of its own, so it is a synthesized
 * shell and never a lab whose site outlived its row. Deliberately an exact host
 * list rather than "a bare path", because a dedicated lab host legitimately serves
 * its lab at its root.
 */
const INSTITUTIONAL_ROOT_HOSTS = new Set(['yale.edu']);

export const normalizeSiteUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
};

const isInstitutionalRoot = (normalized: string): boolean =>
  INSTITUTIONAL_ROOT_HOSTS.has(normalized);

const isPersonPage = (normalized: string): boolean =>
  normalized.includes('/profile/') || normalized.includes('/people/');

export interface ArchivedLabRestoreRowInput {
  slug?: unknown;
  name?: unknown;
  websiteUrl?: unknown;
  archivedReason?: unknown;
  descriptionChars?: number;
  /** True only when `canonicalGroupId` resolves to a row that is live today. */
  canonicalResolvesToLiveRow?: boolean;
  /** The stored `sourceLinkHealth` verdict for this row's own `websiteUrl`, if one exists. */
  ownSiteHealthStatus?: unknown;
}

export interface ArchivedLabRestoreContext {
  /** Every `websiteUrl` and `sourceUrls` entry a live row serves, normalized. */
  liveServedSiteUrls: ReadonlySet<string>;
}

export function classifyArchivedLabRestoreCandidate(
  row: ArchivedLabRestoreRowInput,
  context: ArchivedLabRestoreContext,
): ArchivedLabRestoreVerdict {
  const site = normalizeSiteUrl(row.websiteUrl);
  if (!site) return 'no_distinct_site';
  if (isInstitutionalRoot(site)) return 'institutional_root_site';
  if (isPersonPage(site)) return 'person_page_site';
  if (context.liveServedSiteUrls.has(site)) return 'site_served_by_live_row';
  if (row.canonicalResolvesToLiveRow === true) return 'survives_under_canonical';
  // Absence of a stored verdict is not a verdict: fewer than half the archived labs
  // carry link health for their own site, so an unprobed row stays a candidate.
  const health = typeof row.ownSiteHealthStatus === 'string' ? row.ownSiteHealthStatus.trim() : '';
  if (health && health !== 'HEALTHY' && health !== 'REDIRECTED' && health !== 'UNKNOWN') {
    return 'site_unreachable';
  }
  if (
    typeof row.archivedReason === 'string' &&
    row.archivedReason.trim() === SUBORDINATE_RANK_ARCHIVE_REASON
  ) {
    return 'lead_cannot_host';
  }
  return 'restore_candidate';
}

export interface ArchivedLabRestoreCandidate {
  slug: string;
  name: string;
  site: string;
  descriptionChars: number;
  ownSiteHealthStatus: string | null;
}

export interface ArchivedLabRestoreReport {
  archivedLabRows: number;
  byVerdict: Record<ArchivedLabRestoreVerdict, number>;
  /**
   * Rows and distinct sites are reported separately because they differ by more
   * than rounding: one lab is routinely held by several person-keyed rows that all
   * cite the same site, and counting rows is how "about 5" became a larger number.
   */
  restoreCandidateRows: number;
  restorableSites: number;
  candidates: ArchivedLabRestoreCandidate[];
  candidatesLackingStoredSiteHealth: number;
}

const presentText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function summarizeArchivedLabRestoreCandidates(
  rows: readonly ArchivedLabRestoreRowInput[],
  context: ArchivedLabRestoreContext,
): ArchivedLabRestoreReport {
  const byVerdict = Object.fromEntries(
    archivedLabRestoreVerdicts.map((verdict) => [verdict, 0]),
  ) as Record<ArchivedLabRestoreVerdict, number>;
  const candidates: ArchivedLabRestoreCandidate[] = [];

  for (const row of rows) {
    const verdict = classifyArchivedLabRestoreCandidate(row, context);
    byVerdict[verdict] += 1;
    if (verdict !== 'restore_candidate') continue;
    candidates.push({
      slug: presentText(row.slug),
      name: presentText(row.name),
      site: normalizeSiteUrl(row.websiteUrl),
      descriptionChars: typeof row.descriptionChars === 'number' ? row.descriptionChars : 0,
      ownSiteHealthStatus: presentText(row.ownSiteHealthStatus) || null,
    });
  }

  candidates.sort((a, b) => a.site.localeCompare(b.site) || a.slug.localeCompare(b.slug));

  return {
    archivedLabRows: rows.length,
    byVerdict,
    restoreCandidateRows: candidates.length,
    restorableSites: new Set(candidates.map((candidate) => candidate.site)).size,
    candidates,
    candidatesLackingStoredSiteHealth: candidates.filter(
      (candidate) => candidate.ownSiteHealthStatus === null,
    ).length,
  };
}
