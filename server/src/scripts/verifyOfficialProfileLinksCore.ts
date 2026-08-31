import type { ResearcherProfileLinkHealthStatus } from '../models/researcher';
import type { SourceLinkHealth } from '../services/sourceLinkHealth';
import { isYaleOfficialProfileUrl } from './backfillResearcherOfficialProfileLinksCore';
import { personPageNameTokensFromUrl } from '../scrapers/utils/personProfileEntityMatch';

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

const personNameTokens = (displayName: unknown): string[] =>
  typeof displayName === 'string'
    ? displayName
        .toLowerCase()
        .split(/[^a-z]+/i)
        .filter(Boolean)
    : [];

const SHORTEST_NICKNAME_TOKEN = 4;

/**
 * Whether two given-name tokens are the same name written short and long
 * (`phil`/`philip`, `chris`/`christopher`). Requiring the shorter side to reach
 * four characters is what keeps an initial out: `a` must never stand in for
 * `alison`, because that is how a same-surname colleague gets claimed.
 */
export function givenNameTokensAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < SHORTEST_NICKNAME_TOKEN) return false;
  return longer.startsWith(shorter);
}

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
  return String(displayName ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Replacement candidates for a dead official link, most trustworthy first: a URL
 * some source was observed publishing for this exact path, then an observed
 * same-host page whose slug names the same person, then the same-host
 * `/profile/<slug>` twin of the dead path, and last a page named after the person
 * rather than after the dead slug. Every candidate is still probed before
 * adoption, so each one is a hypothesis to test rather than a rewrite rule.
 *
 * The name-derived pair is what recovers a link whose stored slug never named the
 * person (`politicalscience.yale.edu/ian-home`) or whose department moved the page
 * the opposite way to the usual migration (`ysph.yale.edu` moved a professor from
 * `/profile/<slug>` to `/people/<slug>`), which is why both sections are tried.
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

  for (const observed of observedSameHostUrls) if (sameSlug(observed)) add(observed);
  for (const observed of observedSameHostUrls) {
    if (profileSlugNamesPerson(observed, displayName)) add(observed);
  }
  if (deadSlug) add(`https://${host}/profile/${deadSlug}`);
  const nameSlug = personNameSlug(displayName);
  if (nameSlug) {
    // Compared by full path, not by slug: a department can move a person between
    // sections while keeping the slug (`/profile/haiqun-lin` to `/people/haiqun-lin`),
    // so the same slug under a different section is a real candidate.
    add(`https://${host}/profile/${nameSlug}`);
    add(`https://${host}/people/${nameSlug}`);
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
