import type { ResearcherProfileLinkHealthStatus } from '../models/researcher';
import type { SourceLinkHealth } from '../services/sourceLinkHealth';
import { isYaleOfficialProfileUrl } from './backfillResearcherOfficialProfileLinksCore';
import { personProfileNameTokensFromUrl } from '../scrapers/utils/personProfileEntityMatch';

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

/**
 * Whether a candidate person-page slug names the same person as a display name.
 * A department can re-slug someone (`douglas-stone` becoming `a-douglas-stone`,
 * `paul-l-tipton` becoming `paul-tipton`), so surname equality plus a whole
 * given-name token appearing on both sides is the tie that survives re-slugging.
 * A first-initial match is deliberately not enough: an initial-led display name
 * ("A Douglas Stone") would otherwise claim any same-surname colleague whose
 * given name starts with that letter ("Alison Stone"), and same-slug people
 * really do exist across Yale sites (#468).
 */
export function profileSlugNamesPerson(candidateUrl: unknown, displayName: unknown): boolean {
  const slugTokens = personProfileNameTokensFromUrl(candidateUrl);
  const nameTokens = personNameTokens(displayName);
  if (!slugTokens || slugTokens.length === 0 || nameTokens.length < 2) return false;
  if (slugTokens.at(-1) !== nameTokens.at(-1)) return false;
  return nameTokens.includes(slugTokens[0]) || slugTokens.includes(nameTokens[0]);
}

/**
 * Replacement candidates for a dead official link, most trustworthy first: a URL
 * some source was observed publishing for this exact path, then an observed
 * same-host page whose slug names the same person, then the same-host
 * `/profile/<slug>` twin of the dead path. Every candidate is still probed before
 * adoption, so each one is a hypothesis to test rather than a rewrite rule.
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
