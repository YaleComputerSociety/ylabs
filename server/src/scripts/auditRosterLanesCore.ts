/**
 * Pure decision layer for `departments:audit-roster-lanes` (#2817).
 *
 * A `dept-faculty-roster` lane that reads part of its roster reports
 * `status: 'ok'`, because the scraper's health check only asks whether it got
 * rows. A missing roster is loud; a partial one is silent, and a plausible
 * partial count is indistinguishable from a small department. This module turns
 * the three probes documented in `skills/scrapers/SKILL.md` into a verdict.
 *
 * No I/O and no database: the CLI gathers evidence, this decides what it means.
 */
import * as cheerio from 'cheerio';
import type { SourceLinkHealthStatus } from '../services/sourceLinkHealth';
import type { RosterPagerStopReason } from '../scrapers/utils/rosterLanePaging';
import {
  isFacultyTitle,
  isSubordinateResearchRank,
} from '../scrapers/sources/yaleDirectoryScraper';
import { isSharedPeopleRosterUrl } from '../utils/researchHomeWebsiteUrl';

export const ROSTER_LANE_AUDIT_ALARM_EXIT_CODE = 2;

/**
 * What kind of faculty a sibling tab lists. An uncovered tab is triage debt to
 * rank rather than a count to drive to zero, and the kinds are not equally worth
 * a lane: an emeritus or cross-appointed listing is mostly people the corpus
 * either does not want or already holds from their home department, while an
 * uncovered PRIMARY listing is a genuine acquisition gap.
 *
 * Ranked by slug, deliberately, because this only orders a human's reading list:
 * whether the tab holds faculty at all is already decided from its rows by
 * `siblingTabFacultyGapKeys`, so a misread slug costs priority, never a verdict.
 */
export type SiblingTabKind = 'emeritus' | 'affiliated' | 'teaching-track' | 'primary';

const SIBLING_TAB_KIND_PATTERNS: readonly [SiblingTabKind, RegExp][] = [
  ['emeritus', /emerit/i],
  ['affiliated', /affiliat|secondary|adjunct|visiting|courtesy/i],
  ['teaching-track', /lecturer|instructional|teaching|gibbs|postdoc|research-(?:staff|faculty)/i],
];

export function classifySiblingTabKind(url: string): SiblingTabKind {
  const leaf = url.replace(/\/+$/, '').split('/').pop() ?? '';
  for (const [kind, pattern] of SIBLING_TAB_KIND_PATTERNS) {
    if (pattern.test(leaf)) return kind;
  }
  return 'primary';
}

/** Path segments under which a roster's sibling tabs live. */
const PEOPLE_ROOT_SEGMENT = /^(?:people|faculty|our-people|directory|profiles)$/i;

export interface RosterLaneEvidence {
  deptKey: string;
  deptName: string;
  schoolName: string;
  url: string;
  paginated: boolean;
  /** Lane whose roster only exists after hydration, so this audit cannot read it. */
  jsRendered: boolean;
  /** Reachability of the configured URL, per `classifySourceLinkHealth`. */
  reachability: SourceLinkHealthStatus;
  httpStatusCode?: number;
  /** Where the configured URL actually landed, when it moved. */
  landedUrl?: string;
  /** Distinct people read across every page the pager walked. */
  peopleRead: number;
  /** Rows read before de-duplication, so a re-served page is visible. */
  rowsRead: number;
  pagesFetched: number;
  pagerStopReason?: RosterPagerStopReason;
  /** Faculty-shaped sibling people tabs no roster config covers. */
  uncoveredSiblingTabUrls: string[];
  error?: string;
}

export type RosterLaneVerdict =
  | 'ok'
  | 'unreachable'
  | 'extractor-error'
  | 'dead-extractor'
  | 'pager-never-terminated'
  | 'redirected-into-tab'
  | 'uncovered-sibling-tab'
  | 'js-rendered-not-audited';

/** Ordered most severe first, so a lane with several problems reports the worst. */
const VERDICT_SEVERITY: readonly RosterLaneVerdict[] = [
  'unreachable',
  'extractor-error',
  'dead-extractor',
  'redirected-into-tab',
  'pager-never-terminated',
  'uncovered-sibling-tab',
  'js-rendered-not-audited',
  'ok',
];

export interface RosterLaneFinding {
  verdict: RosterLaneVerdict;
  detail: string;
}

/**
 * Normalizes a URL for comparison, folding scheme, `www.`, a trailing slash and
 * case, so a config and a redirect target that differ only cosmetically match.
 */
export function laneUrlIdentityKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * True when `landedUrl` is a strictly deeper path on the same host than the
 * configured URL, which is the shape of a `/people` root redirecting into one
 * tab of a tabbed roster. A scheme upgrade or a trailing-slash change is not.
 */
export function redirectLandedDeeper(configUrl: string, landedUrl: string | undefined): boolean {
  if (!landedUrl) return false;
  let configured: URL;
  let landed: URL;
  try {
    configured = new URL(configUrl);
    landed = new URL(landedUrl);
  } catch {
    return false;
  }
  if (
    configured.hostname.toLowerCase().replace(/^www\./, '') !==
    landed.hostname.toLowerCase().replace(/^www\./, '')
  ) {
    return false;
  }
  const configuredPath = configured.pathname.replace(/\/+$/, '').toLowerCase();
  const landedPath = landed.pathname.replace(/\/+$/, '').toLowerCase();
  if (configuredPath === landedPath) return false;
  return landedPath.startsWith(`${configuredPath}/`);
}

/**
 * Sibling people tabs linked from a roster page, confined to the configured
 * URL's own subtree rather than its host, so a shared CMS cannot lend this lane
 * another department's roster.
 */
export function siblingPeopleTabUrls(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  const segments = basePath.split('/').filter(Boolean);
  const peopleRootIndex = segments.findIndex((segment) => PEOPLE_ROOT_SEGMENT.test(segment));
  if (peopleRootIndex === -1) return [];
  const subtree = `/${segments.slice(0, peopleRootIndex + 1).join('/')}`;

  const $ = cheerio.load(html);
  const found = new Map<string, string>();
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (resolved.hostname.toLowerCase() !== base.hostname.toLowerCase()) return;
    const path = resolved.pathname.replace(/\/+$/, '');
    if (path === basePath) return;
    if (!path.toLowerCase().startsWith(`${subtree.toLowerCase()}/`)) return;
    const tail = path
      .slice(subtree.length + 1)
      .split('/')
      .filter(Boolean);
    if (tail.length !== 1 || !tail[0]) return;
    // Depth alone does not separate a tab from a person: economics.yale.edu
    // publishes individuals directly at `/people/<name>`, so a depth-only rule
    // reported 12 person profiles as coverage gaps. A tab is a page whose leaf
    // names a GROUP, which `isSharedPeopleRosterUrl` already decides. Whether the
    // group is FACULTY is decided later, from the rows, not from the slug.
    if (!isSharedPeopleRosterUrl(resolved.toString())) return;
    resolved.hash = '';
    resolved.search = '';
    found.set(laneUrlIdentityKey(resolved.toString()), resolved.toString());
  });
  return Array.from(found.values()).sort();
}

/**
 * Sibling tabs no config covers. A tab another lane already reads is coverage,
 * not a gap, which is why the six School of Management lanes sharing one
 * `deptKey` do not report each other.
 */
export function uncoveredSiblingTabs(
  siblingUrls: string[],
  configuredUrls: readonly string[],
): string[] {
  const covered = new Set(configuredUrls.map(laneUrlIdentityKey));
  return siblingUrls.filter((url) => !covered.has(laneUrlIdentityKey(url)));
}

/**
 * The people on a candidate sibling tab who make it a genuine faculty-coverage
 * gap: they state a faculty rank, and no configured lane on that host read them.
 *
 * Neither half can be dropped. A slug denylist cannot decide rank, and the first
 * version of this audit tried: it reported 91 tabs across 40 lanes, nearly all
 * of them postdocs, lecturers, research staff and postgraduate associates, which
 * is a report nobody can act on. And a rank test alone cannot decide coverage,
 * because Yale aliases tabs, so `/people/faculty` and `/people/core-faculty`
 * serve the same professors under two URLs.
 *
 * The rank test is the same one the lanes themselves apply, so a tab is judged a
 * gap only when it holds somebody a lane would have stored.
 */
export function siblingTabFacultyGapKeys(
  tabEntries: readonly { title?: string; identityKey: string }[],
  peopleReadOnHost: ReadonlySet<string>,
): string[] {
  return tabEntries
    .filter((entry) => isFacultyTitle(entry.title) && !isSubordinateResearchRank(entry.title))
    .map((entry) => entry.identityKey)
    .filter((key) => key && !peopleReadOnHost.has(key));
}

export function classifyRosterLane(evidence: RosterLaneEvidence): RosterLaneFinding {
  const findings: RosterLaneFinding[] = [];

  // A lane whose roster only exists after hydration cannot be measured here, and
  // saying so is the honest answer: reporting a verdict from the JS-rendered
  // stub's deliberate throw would call six healthy SEAS lanes unreachable.
  if (evidence.jsRendered) {
    return {
      verdict: 'js-rendered-not-audited',
      detail:
        'lane needs a headless browser, so this audit cannot read its roster; measure it with the rendered fetch path instead',
    };
  }

  // A blocked fetch, a broken extractor and an empty page all yield no rows, and
  // they need different fixes, so each gets its own verdict (#2817).
  if (evidence.reachability === 'UNAVAILABLE') {
    findings.push({
      verdict: 'unreachable',
      detail: `configured URL did not answer (${evidence.reachability}${
        evidence.httpStatusCode ? ` ${evidence.httpStatusCode}` : ''
      })`,
    });
  } else if (evidence.pagerStopReason === 'extractor-error') {
    findings.push({
      verdict: 'extractor-error',
      detail: `page answered ${evidence.reachability}${
        evidence.httpStatusCode ? ` ${evidence.httpStatusCode}` : ''
      } but the lane's extractor threw: ${evidence.error ?? 'unknown error'}`,
    });
  } else if (evidence.pagerStopReason === 'fetch-failed') {
    findings.push({
      verdict: 'unreachable',
      detail: `fetch failed despite a ${evidence.reachability} probe: ${evidence.error ?? 'unknown error'}`,
    });
  } else if (evidence.peopleRead === 0) {
    findings.push({
      verdict: 'dead-extractor',
      detail: `fetched ${evidence.reachability}${
        evidence.httpStatusCode ? ` ${evidence.httpStatusCode}` : ''
      } but the lane's own extractor returned no rows; re-verify the URL and the extractor`,
    });
  }

  if (redirectLandedDeeper(evidence.url, evidence.landedUrl)) {
    findings.push({
      verdict: 'redirected-into-tab',
      detail: `configured URL redirects to the deeper path ${evidence.landedUrl}, so this lane reads one tab rather than the roster`,
    });
  }

  // Repeat detection stops a re-serving pager, so reaching the cap means every
  // one of those pages carried NEW people: the roster is larger than the cap and
  // the lane's read is bounded by MAX_PAGES_PER_DEPT rather than by the roster.
  if (evidence.pagerStopReason === 'page-cap') {
    findings.push({
      verdict: 'pager-never-terminated',
      detail: `pager reached the ${evidence.pagesFetched}-page cap with new people on every page, so the roster is larger than the cap and ${evidence.peopleRead} is a floor rather than the roster size`,
    });
  }

  if (evidence.uncoveredSiblingTabUrls.length > 0) {
    const byKind = evidence.uncoveredSiblingTabUrls.map(
      (url) => `${url} (${classifySiblingTabKind(url)})`,
    );
    findings.push({
      verdict: 'uncovered-sibling-tab',
      detail: `${evidence.uncoveredSiblingTabUrls.length} sibling tab(s) hold faculty no lane on this host read: ${byKind.join(', ')}`,
    });
  }

  if (findings.length === 0) {
    return {
      verdict: 'ok',
      detail: `read ${evidence.peopleRead} people from ${evidence.rowsRead} rows across ${evidence.pagesFetched} page(s), pager stopped on ${evidence.pagerStopReason ?? 'single-page'}`,
    };
  }
  findings.sort(
    (a, b) => VERDICT_SEVERITY.indexOf(a.verdict) - VERDICT_SEVERITY.indexOf(b.verdict),
  );
  return {
    verdict: findings[0]!.verdict,
    detail: findings.map((finding) => finding.detail).join('; '),
  };
}

export interface RosterLaneAuditRow extends RosterLaneEvidence {
  verdict: RosterLaneVerdict;
  detail: string;
  /** Rows read beyond the distinct people, which is re-served pager waste. */
  redundantRowsRead: number;
}

/**
 * Verdicts that mean a lane is broken, as opposed to carrying coverage debt.
 *
 * An uncovered sibling tab is deliberately NOT here. Nearly every one is an
 * emeritus, cross-appointed or teaching-track listing, so alarming on them would
 * have failed the run on 32 of 118 lanes and trained everybody to ignore the
 * exit code. They stay in the report, ranked by kind, as a reading list.
 * `js-rendered-not-audited` is excluded for the opposite reason: the audit is
 * admitting it did not measure, which is not a claim about the lane.
 */
const ALARMING_VERDICTS: readonly RosterLaneVerdict[] = [
  'unreachable',
  'extractor-error',
  'dead-extractor',
  'redirected-into-tab',
  'pager-never-terminated',
];

export interface RosterLaneAuditReport {
  status: 'ok' | 'findings';
  lanesAudited: number;
  peopleRead: number;
  verdictCounts: Record<RosterLaneVerdict, number>;
  /** Lanes whose verdict means broken rather than owing coverage debt. */
  brokenLanes: number;
  /** Uncovered sibling tabs by kind, so the debt can be triaged by value. */
  siblingTabsByKind: Record<SiblingTabKind, number>;
  /** Wasted rows across every lane, the cost of a pager that never terminates. */
  redundantRowsRead: number;
  lanes: RosterLaneAuditRow[];
}

export function summarizeRosterLaneAudit(
  evidence: readonly RosterLaneEvidence[],
): RosterLaneAuditReport {
  const verdictCounts = Object.fromEntries(
    VERDICT_SEVERITY.map((verdict) => [verdict, 0]),
  ) as Record<RosterLaneVerdict, number>;

  const lanes: RosterLaneAuditRow[] = evidence.map((lane) => {
    const finding = classifyRosterLane(lane);
    verdictCounts[finding.verdict] += 1;
    return {
      ...lane,
      verdict: finding.verdict,
      detail: finding.detail,
      redundantRowsRead: Math.max(0, lane.rowsRead - lane.peopleRead),
    };
  });

  // Sort findings to the top so a report is readable without filtering.
  lanes.sort((a, b) => {
    const bySeverity = VERDICT_SEVERITY.indexOf(a.verdict) - VERDICT_SEVERITY.indexOf(b.verdict);
    return bySeverity !== 0 ? bySeverity : a.deptKey.localeCompare(b.deptKey);
  });

  const siblingTabsByKind: Record<SiblingTabKind, number> = {
    primary: 0,
    affiliated: 0,
    emeritus: 0,
    'teaching-track': 0,
  };
  const countedTabs = new Set<string>();
  for (const lane of lanes) {
    for (const url of lane.uncoveredSiblingTabUrls) {
      if (countedTabs.has(url)) continue;
      countedTabs.add(url);
      siblingTabsByKind[classifySiblingTabKind(url)] += 1;
    }
  }

  const brokenLanes = lanes.filter((lane) => ALARMING_VERDICTS.includes(lane.verdict)).length;

  return {
    status: brokenLanes === 0 ? 'ok' : 'findings',
    lanesAudited: lanes.length,
    peopleRead: lanes.reduce((total, lane) => total + lane.peopleRead, 0),
    verdictCounts,
    brokenLanes,
    siblingTabsByKind,
    redundantRowsRead: lanes.reduce((total, lane) => total + lane.redundantRowsRead, 0),
    lanes,
  };
}
