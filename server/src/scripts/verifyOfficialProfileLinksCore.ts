import type { ResearcherProfileLinkHealthStatus } from '../models/researcher';
import type { SourceLinkHealth } from '../services/sourceLinkHealth';
import { isYaleOfficialProfileUrl } from './backfillResearcherOfficialProfileLinksCore';
import { personPageNameTokensFromUrl } from '../scrapers/utils/personProfileEntityMatch';
import { givenNameTokensAgree } from '../scrapers/utils/piNameMatch';

export type OfficialProfileLinkVerdict = 'healthy' | 'repaired' | 'dead' | 'inconclusive';

export interface OfficialProfileLinkRow {
  researcherId: string;
  displayName?: string;
  host: string;
  url: string;
  verdict: OfficialProfileLinkVerdict;
  httpStatusCode?: number;
  replacementUrl?: string;
}

export interface DepartmentLinkHealthSummary {
  host: string;
  total: number;
  healthy: number;
  repaired: number;
  dead: number;
  inconclusive: number;
}

/**
 * A probe only settles a link when it comes back decisive. 403/429/5xx and
 * transport failures mean the department site would not talk to us, not that the
 * person's page is gone, so they must never retire a link or license a
 * replacement: a wrong verdict here erases a working profile link.
 */
export function isDecisivelyDeadProbe(health: SourceLinkHealth | undefined): boolean {
  if (!health) return false;
  if (health.healthStatus !== 'UNAVAILABLE') return false;
  const status = health.httpStatusCode;
  if (typeof status !== 'number') return false;
  return status === 404 || status === 410;
}

export function isDecisivelyLiveProbe(health: SourceLinkHealth | undefined): boolean {
  if (!health) return false;
  return health.healthStatus === 'HEALTHY' || health.healthStatus === 'REDIRECTED';
}

export function storedHealthStatusFor(
  health: SourceLinkHealth | undefined,
): ResearcherProfileLinkHealthStatus {
  if (isDecisivelyLiveProbe(health)) return 'HEALTHY';
  if (isDecisivelyDeadProbe(health)) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

/**
 * The health status an apply run may write, or `undefined` when the probe settled
 * nothing. `UNKNOWN` is the absence of a probed fact, so writing it would erase
 * the verdict of an earlier decisive probe: a bot-blocked re-probe would un-retire
 * a page already proved gone and start serving that 404 to students again.
 */
export function settledHealthStatusFor(
  health: SourceLinkHealth | undefined,
): ResearcherProfileLinkHealthStatus | undefined {
  const status = storedHealthStatusFor(health);
  return status === 'UNKNOWN' ? undefined : status;
}

/**
 * A probe worth retrying: the site answered with a throttle or a server-side
 * failure rather than a verdict. Sustained sequential probing of a large host
 * (medicine.yale.edu carries most of the corpus) draws 403s partway through a run,
 * which left roughly a tenth of the links unverified until the run backed off.
 */
export function isRetryableProbe(health: SourceLinkHealth | undefined): boolean {
  if (!health) return true;
  if (isDecisivelyLiveProbe(health) || isDecisivelyDeadProbe(health)) return false;
  const status = health.httpStatusCode;
  if (typeof status !== 'number') return true;
  return status === 403 || status === 408 || status === 429 || status >= 500;
}

export function probeRetryDelayMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** Math.max(0, attempt - 1);
}

export function officialProfileLinkHost(url: unknown): string | undefined {
  if (!isYaleOfficialProfileUrl(url)) return undefined;
  try {
    return new URL(String(url).trim()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * An apostrophe inside a surname is elided, not treated as a token boundary,
 * because Yale's own slugs elide it: `O'Hern` is published at
 * `/profile/corey-ohern`. Splitting on it yields `o` + `hern`, whose surname token
 * matches no slug, so every apostrophe surname failed `profileSlugNamesPerson` and
 * could never be repaired (#2522).
 */
const foldNameApostrophes = (value: string): string => value.replace(/['’ʼ]/g, '');

const personNameTokens = (displayName: unknown): string[] =>
  typeof displayName === 'string'
    ? foldNameApostrophes(displayName)
        .toLowerCase()
        .split(/[^a-z]+/i)
        .filter(Boolean)
    : [];

/**
 * Whether a candidate person-page slug names the same person as a display name.
 * A department can re-slug someone (`douglas-stone` becoming `a-douglas-stone`,
 * `paul-l-tipton` becoming `paul-tipton`) or publish them under a nickname
 * (`philip-gorski` becoming `phil-gorski`, #2308), so the tie is surname equality
 * plus a given-name token that agrees whole or as a short form.
 * A first-initial match is deliberately not enough: an initial-led display name
 * ("A Douglas Stone") would otherwise claim any same-surname colleague whose
 * given name starts with that letter ("Alison Stone"), and same-surname people
 * really do exist across Yale sites (#468).
 */
export function profileSlugNamesPerson(candidateUrl: unknown, displayName: unknown): boolean {
  const slugTokens = personPageNameTokensFromUrl(candidateUrl);
  const nameTokens = personNameTokens(displayName);
  if (!slugTokens || slugTokens.length === 0 || nameTokens.length < 2) return false;
  if (slugTokens.at(-1) !== nameTokens.at(-1)) return false;
  return (
    nameTokens.some((token) => givenNameTokensAgree(token, slugTokens[0])) ||
    slugTokens.some((token) => givenNameTokensAgree(token, nameTokens[0]))
  );
}

/**
 * The person-page slug a department would mint from a display name.
 */
export function personNameSlug(displayName: unknown): string {
  return foldNameApostrophes(String(displayName ?? ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Replacement candidates for a dead official link, most trustworthy first: a URL
 * some source was observed publishing for this exact path, then an observed
 * same-host page whose slug names the same person, then the same-host
 * `/profile/<slug>` twin of the dead path, its `/people/<slug>` twin, and last a
 * page named after the person rather than after the dead slug. Every candidate is
 * still probed before adoption, so each one is a hypothesis to test rather than a
 * rewrite rule.
 *
 * The reverse-section twin follows a department that moved the page the opposite
 * way to the usual migration (`ysph.yale.edu` moved a professor from
 * `/profile/<slug>` to `/people/<slug>`), and the name-derived pair recovers a link
 * whose stored slug never named the person at all
 * (`politicalscience.yale.edu/ian-home`). Both are constructed rather than
 * observed, so each must still pass the same person-page check an observed
 * candidate passes: a display name that leaked a roster label ("Primary Faculty")
 * or carries no surname would otherwise mint `/people/primary-faculty`, and a
 * roster page probes live, which would stamp it HEALTHY on the researcher.
 */
export function officialProfileLinkCandidates(
  deadUrl: string,
  displayName?: unknown,
  observedSameHostUrls: readonly string[] = [],
): string[] {
  const host = officialProfileLinkHost(deadUrl);
  if (!host) return [];
  let deadPath: string;
  try {
    deadPath = new URL(deadUrl.trim()).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return [];
  }
  const deadSlug = deadPath.split('/').pop() || '';

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (!isYaleOfficialProfileUrl(value)) return;
    const candidate = String(value).trim();
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return;
    }
    if (parsed.hostname.toLowerCase() !== host) return;
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    if (path === deadPath || seen.has(path)) return;
    seen.add(path);
    candidates.push(candidate);
  };

  const sameSlug = (url: string): boolean => {
    try {
      return (
        (new URL(url).pathname.replace(/\/+$/, '').toLowerCase().split('/').pop() || '') ===
        deadSlug
      );
    } catch {
      return false;
    }
  };

  const addPersonPage = (value: string) => {
    if (profileSlugNamesPerson(value, displayName)) add(value);
  };

  for (const observed of observedSameHostUrls) if (sameSlug(observed)) add(observed);
  for (const observed of observedSameHostUrls) addPersonPage(observed);
  if (deadSlug) {
    add(`https://${host}/profile/${deadSlug}`);
    addPersonPage(`https://${host}/people/${deadSlug}`);
  }
  const nameSlug = personNameSlug(displayName);
  if (nameSlug) {
    addPersonPage(`https://${host}/profile/${nameSlug}`);
    addPersonPage(`https://${host}/people/${nameSlug}`);
  }
  return candidates;
}

export function summarizeDepartmentLinkHealth(
  rows: readonly OfficialProfileLinkRow[],
): DepartmentLinkHealthSummary[] {
  const byHost = new Map<string, DepartmentLinkHealthSummary>();
  for (const row of rows) {
    let summary = byHost.get(row.host);
    if (!summary) {
      summary = { host: row.host, total: 0, healthy: 0, repaired: 0, dead: 0, inconclusive: 0 };
      byHost.set(row.host, summary);
    }
    summary.total += 1;
    summary[row.verdict] += 1;
  }
  return [...byHost.values()].sort(
    (a, b) => b.dead + b.repaired - (a.dead + a.repaired) || b.total - a.total,
  );
}

/**
 * Whether a link is due for a re-probe, given how long ago it was last verified.
 *
 * `--limit` truncates the head of a stable read order and the candidate list never
 * skipped anything, so a bounded run re-probed the same first N links every time
 * and could not advance past them: the tail was not merely sampled, it was
 * permanently unreachable, and the never-probed population this lane exists to
 * drain would sit there forever (#3222). Filtering on staleness is what turns
 * `--limit` into a rate limiter instead of a blind spot, because a link verified
 * by one run drops out of the next run's candidates.
 *
 * Age is not the only thing that makes a link due, and reading it that way made
 * the window skip the exact population it was added to drain. A link probed
 * yesterday that came back 403 carries a fresh `verifiedAt` and a stored status of
 * `UNKNOWN`, which is the absence of a verdict rather than a verdict; treating it
 * as fresh parked it for the whole window. Measured when this was age-only: a
 * 30-day window on the largest host reported 0 links due while 439 links corpus-wide
 * held no decisive status at all. So a link is due unless it is BOTH recent AND
 * decisively judged.
 *
 * A link with no `verifiedAt` is always due too. That is the population with no
 * recorded fact at all, so it is the last thing a bounded run should skip.
 */
/**
 * Hours a link that did NOT settle waits before being probed again (#3303).
 *
 * `verifiedAt` is already stamped on every probe, settled or not, but an unsettled link
 * was treated as always due, so a run that met a throttle wall on the largest host
 * re-probed exactly the same links in the same order on the next pass and stopped in the
 * same place. The links beyond the wall were never reached, and the `UNKNOWN` count came
 * out identical run after run, which is the signature this fixes.
 *
 * The rule it must not break is the one below it: an `UNKNOWN` stored status is the
 * absence of a probed fact, so it can never be treated as fresh indefinitely. This is a
 * back-off, not a cache. After the window the link is due again, so nothing is
 * permanently masked by a bot-blocked probe.
 *
 * The window has to be LONGER than the interval between runs of the stage, or it defers
 * nothing: the next pass arrives after the window has already expired and re-probes the
 * same wall. 20 hours suits a daily sweep, so consecutive days rotate through the links a
 * throttled host refused rather than retrying the same head of the list. Measured on
 * Development, all 297 remaining `UNKNOWN` links have been attempted at least once and
 * none is unattempted, so this population is exactly the one the window governs.
 */
export const DEFAULT_UNSETTLED_RETRY_HOURS = 20;

export function isProfileLinkDueForVerification(
  verifiedAt: unknown,
  staleAfterDays: number,
  now: Date = new Date(),
  storedHealthStatus?: unknown,
  unsettledRetryHours: number = DEFAULT_UNSETTLED_RETRY_HOURS,
): boolean {
  if (staleAfterDays <= 0) return true;
  const attempted = verifiedAt instanceof Date ? verifiedAt : new Date(String(verifiedAt ?? ''));
  const neverAttempted = Number.isNaN(attempted.getTime());
  const settled = storedHealthStatus === 'HEALTHY' || storedHealthStatus === 'UNAVAILABLE';

  if (!settled) {
    // Never attempted is always due: a back-off may only defer a link we have tried.
    if (neverAttempted || unsettledRetryHours <= 0) return true;
    const ageHours = (now.getTime() - attempted.getTime()) / 3_600_000;
    return ageHours >= unsettledRetryHours;
  }

  if (neverAttempted) return true;
  const ageDays = (now.getTime() - attempted.getTime()) / 86_400_000;
  return ageDays >= staleAfterDays;
}

export interface ProfileLinkVerificationCoverage {
  /** Links the staleness filter judged due, before `--limit` narrows them. */
  linksDue: number;
  /** Links this run set out to probe, after `--limit`. */
  attempted: number;
  probed: number;
  hostsPlanned: number;
  hostsCompleted: number;
  /** Attempted links this run did not reach. Non-zero means it stopped early. */
  linksUnreached: number;
  /** Due links no run has reached yet, whether because of `--limit` or an early stop. */
  linksStillDue: number;
  complete: boolean;
}

/**
 * Whether a run covered what it set out to cover, reported as numbers rather than
 * as an exit code.
 *
 * The lane died four times in one night on the host that carries most of the corpus,
 * and because the report was written once after the last host, a death at 90% wrote
 * nothing and was indistinguishable from a death at 0%: the only way to tell was to
 * read the corpus. `complete` is derived from hosts finished rather than from the
 * process exiting, so a partial run is reportable as partial (#3303).
 *
 * `complete` deliberately does NOT mean "nothing is left due". A bounded run is
 * complete when it finishes the hosts it planned, and `linksStillDue` carries what a
 * later run must pick up. Conflating the two would make every rate-limited run look
 * broken, which is how a real failure stops being read.
 */
export function profileLinkVerificationCoverage(input: {
  linksDue: number;
  attempted: number;
  probed: number;
  hostsPlanned: number;
  hostsCompleted: number;
}): ProfileLinkVerificationCoverage {
  const linksUnreached = Math.max(0, input.attempted - input.probed);
  return {
    linksDue: input.linksDue,
    attempted: input.attempted,
    probed: input.probed,
    hostsPlanned: input.hostsPlanned,
    hostsCompleted: input.hostsCompleted,
    linksUnreached,
    linksStillDue: Math.max(0, input.linksDue - input.probed),
    complete: input.hostsCompleted === input.hostsPlanned && linksUnreached === 0,
  };
}

/**
 * How many of a run's probes ended in a verdict that can be stored.
 *
 * A throttled 403 is retryable and settles nothing, so "probed" overstates progress
 * on a host that rate-limits: the count of links verified is never the count of links
 * that gained a verdict. Reported separately so a run that drew blocks reads as one
 * (#3303).
 */
export function decisiveVerdictCount(rows: readonly OfficialProfileLinkRow[]): number {
  return rows.filter((row) => row.verdict !== 'inconclusive').length;
}
