/**
 * Plans the retirement of `official-profile-pi-backfill` observations whose value was read
 * from text Cheerio's `.text()` had glued together (#5720): an address with a page word fused
 * onto its front, a title that absorbed the fields beside it, and the subject key minted from
 * a glued address.
 *
 * The predicates only choose which pages to re-read. A verdict comes from a fresh reading of
 * the cited page with the fixed extractor (#5729), so an observation is retired only when the
 * page no longer yields its value, and a re-run re-reads the page instead of trusting a plan.
 */

export const GLUED_PROFILE_TEXT_SOURCE_NAME = 'official-profile-pi-backfill';

export interface StoredProfileObservation {
  id: string;
  entityType: 'user' | 'researchEntity';
  entityKey: string;
  field: string;
  value: unknown;
  sourceUrl: string;
}

export interface PageFieldReading {
  email?: string;
  title?: string;
}

export type PageRead =
  { status: 'read'; reading: PageFieldReading } | { status: 'failed' } | { status: 'deferred' };

export interface PhantomSubject {
  netid: string;
  userObservationIds: string[];
  piKeyObservationIds: string[];
}

export interface GluedPageTarget {
  sourceUrl: string;
  emails: StoredProfileObservation[];
  titles: StoredProfileObservation[];
  phantoms: PhantomSubject[];
}

export interface GluedProfileTextCounts {
  pagesTargeted: number;
  pagesFetched: number;
  pagesFailed: number;
  pagesDeferred: number;
  emailCandidates: number;
  titleCandidates: number;
  phantomSubjectCandidates: number;
  phantomSubjectObservationCandidates: number;
  emailRetired: number;
  emailRetiredPageYieldsNone: number;
  titleRetired: number;
  titleRetiredPageYieldsNone: number;
  phantomSubjectObservationsRetired: number;
  emailKept: number;
  titleKept: number;
  phantomSubjectObservationsKept: number;
  deferredEmail: number;
  deferredTitle: number;
  deferredPhantomSubjectObservations: number;
  distinctObservationsToRetire: number;
}

export interface GluedProfileTextPlan {
  observationIdsToRetire: string[];
  counts: GluedProfileTextCounts;
}

const MIN_GLUED_PREFIX_LENGTH = 3;

const lower = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const keyNetid = (entityKey: string): string =>
  entityKey.toLowerCase().startsWith('netid:')
    ? entityKey.slice('netid:'.length).toLowerCase()
    : '';

const localPart = (address: string): string => address.split('@')[0] ?? '';

/**
 * The address a glued value hides: the value is a run of letters fused onto the front of an
 * address the same subject or the same page also states, as "biology" before "a.b@yale.edu".
 */
export function gluedAddressTwin(value: unknown, knownAddresses: ReadonlySet<string>): string {
  const address = lower(value);
  const local = localPart(address);
  const domain = address.slice(local.length);
  if (!local || !domain.startsWith('@')) return '';
  for (let cut = MIN_GLUED_PREFIX_LENGTH; cut < local.length; cut += 1) {
    if (!/^[a-z]+$/.test(local.slice(0, cut))) return '';
    const twin = `${local.slice(cut)}${domain}`;
    if (knownAddresses.has(twin)) return twin;
  }
  return '';
}

const DEGREE_TOKENS = /\b(?:PhD|DPhil|MPhil|MSc|BSc|MSt|MDiv|ThD|EdD|DrPH|ScD|DMSc|MBBS|BPhil)\b/g;
const NAME_PARTICLE_JOIN = /\b(?:Mc|Mac|De|Di|Da|Le|La|Van|Von|Du)(?=[A-Z])/g;
const CONTACT_LABEL = /\b(?:Office|Website|Phone|Email|E-mail|Fax|Address)\s*:/i;

/**
 * A title read from a block that also held other fields: it carries an address or a contact
 * label, or two words run together with no space between them ("BiologyAddress").
 */
export function isGluedProfileTitle(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.includes('@') || CONTACT_LABEL.test(value)) return true;
  const withoutLegitimateJoins = value.replace(DEGREE_TOKENS, ' ').replace(NAME_PARTICLE_JOIN, '');
  return /[a-z][A-Z]/.test(withoutLegitimateJoins);
}

/**
 * The pages to re-read, each with the observations it cited that a glued predicate selects.
 * The address maps hold every live address from any lane on each user key and on each cited
 * page, so a twin stated elsewhere about the same person or on the same page counts.
 */
export function selectGluedProfileTextTargets(input: {
  laneObservations: StoredProfileObservation[];
  otherAddressesBySubject: ReadonlyMap<string, ReadonlySet<string>>;
  otherAddressesByPage: ReadonlyMap<string, ReadonlySet<string>>;
}): GluedPageTarget[] {
  const byPage = new Map<string, GluedPageTarget>();
  const target = (sourceUrl: string): GluedPageTarget => {
    const existing = byPage.get(sourceUrl);
    if (existing) return existing;
    const created: GluedPageTarget = { sourceUrl, emails: [], titles: [], phantoms: [] };
    byPage.set(sourceUrl, created);
    return created;
  };

  const userObservations = input.laneObservations.filter((row) => row.entityType === 'user');

  for (const row of userObservations) {
    if (!row.sourceUrl) continue;
    if (row.field === 'title' && isGluedProfileTitle(row.value))
      target(row.sourceUrl).titles.push(row);
    if (row.field !== 'email') continue;
    const value = lower(row.value);
    const known = new Set<string>([
      ...(input.otherAddressesBySubject.get(row.entityKey.toLowerCase()) ?? []),
      ...(input.otherAddressesByPage.get(row.sourceUrl) ?? []),
    ]);
    known.delete(value);
    if (!gluedAddressTwin(value, known)) continue;
    const page = target(row.sourceUrl);
    page.emails.push(row);
    const netid = keyNetid(row.entityKey);
    if (netid && netid === localPart(value) && !page.phantoms.some((p) => p.netid === netid)) {
      page.phantoms.push({
        netid,
        userObservationIds: userObservations
          .filter((other) => other.entityKey.toLowerCase() === row.entityKey.toLowerCase())
          .map((other) => other.id),
        piKeyObservationIds: input.laneObservations
          .filter(
            (other) =>
              other.entityType === 'researchEntity' &&
              other.field === 'inferredPiUserKey' &&
              lower(other.value) === netid,
          )
          .map((other) => other.id),
      });
    }
  }
  return [...byPage.values()].sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isSkippedHost(url: string, skipHosts: readonly string[]): boolean {
  const host = hostOf(url);
  return skipHosts.some((skip) => {
    const normalized = skip.trim().toLowerCase();
    return Boolean(normalized) && (host === normalized || host.endsWith(`.${normalized}`));
  });
}

const sameTitle = (left: unknown, right: string | undefined): boolean =>
  typeof left === 'string' && left.replace(/\s+/g, ' ').trim() === (right ?? '').trim();

const emptyCounts = (): GluedProfileTextCounts => ({
  pagesTargeted: 0,
  pagesFetched: 0,
  pagesFailed: 0,
  pagesDeferred: 0,
  emailCandidates: 0,
  titleCandidates: 0,
  phantomSubjectCandidates: 0,
  phantomSubjectObservationCandidates: 0,
  emailRetired: 0,
  emailRetiredPageYieldsNone: 0,
  titleRetired: 0,
  titleRetiredPageYieldsNone: 0,
  phantomSubjectObservationsRetired: 0,
  emailKept: 0,
  titleKept: 0,
  phantomSubjectObservationsKept: 0,
  deferredEmail: 0,
  deferredTitle: 0,
  deferredPhantomSubjectObservations: 0,
  distinctObservationsToRetire: 0,
});

/**
 * Decide each target from its page read. A failed read retires nothing for that page, and a
 * deferred one (a host lock) is only counted.
 */
export function planGluedProfileTextRetirement(
  targets: GluedPageTarget[],
  reads: ReadonlyMap<string, PageRead>,
): GluedProfileTextPlan {
  const counts = emptyCounts();
  const retire = new Set<string>();
  for (const page of targets) {
    const phantomObservations = page.phantoms.reduce(
      (sum, phantom) =>
        sum + phantom.userObservationIds.length + phantom.piKeyObservationIds.length,
      0,
    );
    counts.pagesTargeted += 1;
    counts.emailCandidates += page.emails.length;
    counts.titleCandidates += page.titles.length;
    counts.phantomSubjectCandidates += page.phantoms.length;
    counts.phantomSubjectObservationCandidates += phantomObservations;

    const read = reads.get(page.sourceUrl) ?? { status: 'failed' };
    if (read.status === 'deferred') {
      counts.pagesDeferred += 1;
      counts.deferredEmail += page.emails.length;
      counts.deferredTitle += page.titles.length;
      counts.deferredPhantomSubjectObservations += phantomObservations;
      continue;
    }
    if (read.status === 'failed') {
      counts.pagesFailed += 1;
      continue;
    }
    counts.pagesFetched += 1;
    const pageEmail = lower(read.reading.email);

    for (const row of page.emails) {
      if (lower(row.value) === pageEmail) counts.emailKept += 1;
      else {
        counts.emailRetired += 1;
        if (!pageEmail) counts.emailRetiredPageYieldsNone += 1;
        retire.add(row.id);
      }
    }
    for (const row of page.titles) {
      if (sameTitle(row.value, read.reading.title)) counts.titleKept += 1;
      else {
        counts.titleRetired += 1;
        if (!read.reading.title) counts.titleRetiredPageYieldsNone += 1;
        retire.add(row.id);
      }
    }
    for (const phantom of page.phantoms) {
      const ids = [...phantom.userObservationIds, ...phantom.piKeyObservationIds];
      if (localPart(pageEmail) === phantom.netid) {
        counts.phantomSubjectObservationsKept += ids.length;
        continue;
      }
      counts.phantomSubjectObservationsRetired += ids.length;
      for (const id of ids) retire.add(id);
    }
  }
  counts.distinctObservationsToRetire = retire.size;
  return { observationIdsToRetire: [...retire].sort(), counts };
}

export type FetchProfileHtml = (url: string) => Promise<string>;

/**
 * Read each target page once, one at a time, pausing between requests. A page on a skipped
 * host is never requested.
 */
export async function readTargetPagesSequentially(
  targets: GluedPageTarget[],
  options: {
    fetchHtml: FetchProfileHtml;
    readFields: (html: string) => PageFieldReading;
    skipHosts: readonly string[];
    pauseMs: number;
    sleep?: (ms: number) => Promise<void>;
    onFailure?: (url: string, error: unknown) => void;
  },
): Promise<Map<string, PageRead>> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const reads = new Map<string, PageRead>();
  let requested = 0;
  for (const page of targets) {
    if (isSkippedHost(page.sourceUrl, options.skipHosts)) {
      reads.set(page.sourceUrl, { status: 'deferred' });
      continue;
    }
    if (requested > 0 && options.pauseMs > 0) await sleep(options.pauseMs);
    requested += 1;
    try {
      const html = await options.fetchHtml(page.sourceUrl);
      reads.set(
        page.sourceUrl,
        html.trim() ? { status: 'read', reading: options.readFields(html) } : { status: 'failed' },
      );
    } catch (error) {
      options.onFailure?.(page.sourceUrl, error);
      reads.set(page.sourceUrl, { status: 'failed' });
    }
  }
  return reads;
}

export function hostTally(rows: Array<{ sourceUrl: string }>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const row of rows) {
    const host = hostOf(row.sourceUrl) || '(unparseable)';
    tally[host] = (tally[host] ?? 0) + 1;
  }
  return tally;
}
