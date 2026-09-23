/**
 * Pure decision layer for `research-homes:audit-rosters` (#2412).
 *
 * `docs/scraper-audit-guide.md`, `docs/research-data-pipeline.md`,
 * `DEVELOPER_GUIDE.md` and `docs/research-student-journey-delivery-plan.md` all
 * named this audit as the criterion for enabling `official-research-home-roster`
 * beyond its reviewed allowlist, and none of it existed, so the criterion could
 * only be met by skipping it. #2411 retracted the claims; this restores them.
 *
 * The checks are the ones those docs already specified: every configured current
 * section still present on the page, every member carrying a unique person-scoped
 * official profile identity and an honestly mapped role, and every membership key
 * in the latest stored snapshot carrying a materialized source-owned current row.
 *
 * No I/O and no database: the runner gathers evidence, this decides what it means.
 */
import { isSharedPeopleRosterUrl } from '../utils/researchHomeWebsiteUrl';
import type { SourceLinkHealthStatus } from '../services/sourceLinkHealth';

export const RESEARCH_HOME_ROSTER_AUDIT_ALARM_EXIT_CODE = 2;

/** Upper bound the docs promise for `--sample-limit`. */
export const RESEARCH_HOME_ROSTER_MAX_SAMPLE = 100;

/**
 * A section label a lane is right to leave unconfigured. The source accepts only
 * sections explicitly declared current, so a former or alumni listing left out is
 * the contract working rather than coverage debt to report.
 */
const RETIRED_SECTION_LABEL = /\b(former|alumni|alumnae|alumnus|past|previous|emerit)/i;

/** An email address or a phone number surviving into a member field. */
const DIRECT_CONTACT_TEXT = /[\w.+-]+@[\w-]+\.\w{2,}|(?:\+?\d[\d ().-]{7,}\d)/;

export interface OfficialRosterMemberEvidence {
  name: string;
  title: string;
  role: string;
  sectionLabel: string;
  profileUrl: string;
  identityKey: string;
  membershipKey: string;
}

export interface OfficialRosterLaneEvidence {
  researchEntityKey: string;
  url: string;
  configuredSections: string[];
  /** Reachability of the configured URL, per `classifySourceLinkHealth`. */
  reachability: SourceLinkHealthStatus;
  httpStatusCode?: number;
  landedUrl?: string;
  /** The extractor's own verdict, or `fetch-error` when it never ran. */
  state: 'current' | 'partial' | 'empty' | 'withheld' | 'stale' | 'fetch-error';
  members: OfficialRosterMemberEvidence[];
  withheldCount: number;
  duplicateCount: number;
  sourcePublishedAt?: string;
  publishAgeDays?: number;
  /** Days before the publish-age ceiling turns this lane's state to `stale`. */
  daysUntilPublishAgeCeiling?: number;
  /** Every member-listing section label present on the page. */
  sectionsOnPage: string[];
  entityExists: boolean;
  entityArchived: boolean;
  storedSnapshotState?: string;
  storedMembershipKeys: string[];
  storedObservedAt?: string;
  storedFreshnessExpiresAt?: string;
  /** Membership keys carrying a live source-owned `CURRENT` role assignment. */
  materializedMembershipKeys: string[];
  /** Materialized source-owned rows whose freshness window has lapsed. */
  expiredMaterializedRows: number;
  error?: string;
}

export type OfficialRosterVerdict =
  | 'ok'
  | 'unreachable'
  | 'fetch-error'
  | 'entity-missing'
  | 'section-contract-broken'
  | 'stale-publish-date'
  | 'member-precision-defect'
  | 'membership-not-materialized'
  | 'snapshot-expired'
  | 'uncovered-section';

/** Ordered most severe first, so a lane with several problems reports the worst. */
const VERDICT_SEVERITY: readonly OfficialRosterVerdict[] = [
  'unreachable',
  'fetch-error',
  'entity-missing',
  'section-contract-broken',
  'stale-publish-date',
  'member-precision-defect',
  'membership-not-materialized',
  'snapshot-expired',
  'uncovered-section',
  'ok',
];

/**
 * Verdicts that mean the acquisition path is defective, as opposed to the corpus
 * owing a refresh.
 *
 * `snapshot-expired` is deliberately absent. Every stored row expires 21 days
 * after its run by design, so alarming on it would fail the gate three weeks after
 * any successful run and train everybody to ignore the exit code. It stays in the
 * report because the serve layer suppresses an expired row, so an expired lane
 * serves an empty roster. `uncovered-section` is coverage debt for the same
 * reason: a page may carry sections this source should never claim.
 */
const ALARMING_VERDICTS: readonly OfficialRosterVerdict[] = [
  'unreachable',
  'fetch-error',
  'entity-missing',
  'section-contract-broken',
  'stale-publish-date',
  'member-precision-defect',
  'membership-not-materialized',
];

export interface OfficialRosterPrecision {
  /** Members whose "profile" URL names a shared listing rather than one person. */
  listingShapedProfileUrls: number;
  /** Members whose profile URL left the roster page's own host. */
  offHostProfileUrls: number;
  /** Members whose profile URL is the roster page itself, the #2357 shape. */
  rosterUrlAsProfileUrl: number;
  /** Identity keys claimed by more than one member of the same roster. */
  duplicateIdentityKeys: number;
  /** Members whose role is absent, so the mapping was not honest but empty. */
  unmappedRoles: number;
  /** Member fields still carrying an email address or phone number. */
  contactTextInMemberFields: number;
}

export function normalizedSectionLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function urlIdentityKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return String(url ?? '')
      .trim()
      .toLowerCase();
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function officialRosterPrecision(
  evidence: OfficialRosterLaneEvidence,
): OfficialRosterPrecision {
  const rosterHost = hostOf(evidence.url);
  const rosterIdentity = urlIdentityKey(evidence.url);
  const identityCounts = new Map<string, number>();
  for (const member of evidence.members) {
    const key = member.identityKey.toLowerCase();
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  return {
    listingShapedProfileUrls: evidence.members.filter((member) =>
      isSharedPeopleRosterUrl(member.profileUrl),
    ).length,
    offHostProfileUrls: evidence.members.filter(
      (member) => Boolean(rosterHost) && hostOf(member.profileUrl) !== rosterHost,
    ).length,
    rosterUrlAsProfileUrl: evidence.members.filter(
      (member) => urlIdentityKey(member.profileUrl) === rosterIdentity,
    ).length,
    duplicateIdentityKeys: Array.from(identityCounts.values()).filter((count) => count > 1).length,
    unmappedRoles: evidence.members.filter((member) => !member.role.trim()).length,
    contactTextInMemberFields: evidence.members.filter(
      (member) => DIRECT_CONTACT_TEXT.test(member.name) || DIRECT_CONTACT_TEXT.test(member.title),
    ).length,
  };
}

export function missingConfiguredSections(evidence: OfficialRosterLaneEvidence): string[] {
  const present = new Set(evidence.sectionsOnPage.map(normalizedSectionLabel));
  return evidence.configuredSections.filter((label) => !present.has(normalizedSectionLabel(label)));
}

/**
 * Sections the page publishes that no config claims, minus the ones a current
 * roster is right to exclude.
 */
export function uncoveredCurrentSections(evidence: OfficialRosterLaneEvidence): string[] {
  const configured = new Set(evidence.configuredSections.map(normalizedSectionLabel));
  return evidence.sectionsOnPage.filter(
    (label) =>
      normalizedSectionLabel(label).length > 0 &&
      !configured.has(normalizedSectionLabel(label)) &&
      !RETIRED_SECTION_LABEL.test(label),
  );
}

export function unmaterializedMembershipKeys(evidence: OfficialRosterLaneEvidence): string[] {
  const materialized = new Set(evidence.materializedMembershipKeys.map((key) => key.toLowerCase()));
  return evidence.storedMembershipKeys.filter((key) => !materialized.has(key.toLowerCase()));
}

export interface OfficialRosterSnapshotDrift {
  addedOnPage: number;
  goneFromPage: number;
}

export function snapshotDrift(evidence: OfficialRosterLaneEvidence): OfficialRosterSnapshotDrift {
  const live = new Set(evidence.members.map((member) => member.membershipKey.toLowerCase()));
  const stored = new Set(evidence.storedMembershipKeys.map((key) => key.toLowerCase()));
  return {
    addedOnPage: Array.from(live).filter((key) => !stored.has(key)).length,
    goneFromPage: Array.from(stored).filter((key) => !live.has(key)).length,
  };
}

export function snapshotExpired(
  evidence: OfficialRosterLaneEvidence,
  now: Date = new Date(),
): boolean {
  if (!evidence.storedFreshnessExpiresAt) return false;
  const expiresAt = new Date(evidence.storedFreshnessExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() < now.getTime();
}

export interface OfficialRosterFinding {
  verdict: OfficialRosterVerdict;
  detail: string;
}

export function classifyOfficialRosterLane(
  evidence: OfficialRosterLaneEvidence,
  now: Date = new Date(),
): OfficialRosterFinding {
  const findings: OfficialRosterFinding[] = [];

  if (evidence.state === 'fetch-error') {
    findings.push({
      verdict: 'fetch-error',
      detail: `the roster page could not be read: ${evidence.error ?? 'unknown error'}`,
    });
  } else if (evidence.reachability === 'UNAVAILABLE') {
    // Only UNAVAILABLE means a server answered that the page is gone. `UNKNOWN` is
    // the audit admitting it could not tell, and a `REDIRECTED` roster still
    // answers, so neither is a defect claim (#2720).
    findings.push({
      verdict: 'unreachable',
      detail: `configured URL is unavailable${
        evidence.httpStatusCode ? ` (HTTP ${evidence.httpStatusCode})` : ''
      }`,
    });
  }

  if (!evidence.entityExists) {
    findings.push({
      verdict: 'entity-missing',
      detail: 'the configured research entity key matches no live row, so nothing can be enriched',
    });
  } else if (evidence.entityArchived) {
    findings.push({
      verdict: 'entity-missing',
      detail: 'the configured research entity is archived, so its roster serves nobody',
    });
  }

  const missingSections = missingConfiguredSections(evidence);
  if (evidence.state !== 'fetch-error' && missingSections.length > 0) {
    findings.push({
      verdict: 'section-contract-broken',
      detail: `the page no longer publishes ${missingSections.length} configured current section(s): ${missingSections.join(', ')}, so the extractor withholds the whole roster`,
    });
  }

  if (evidence.state === 'stale') {
    findings.push({
      verdict: 'stale-publish-date',
      detail: `the page's publish date is ${
        evidence.publishAgeDays === undefined
          ? 'missing'
          : `${Math.round(evidence.publishAgeDays)} days old`
      }, past the source's ceiling, so the lane emits no members`,
    });
  }

  const precision = officialRosterPrecision(evidence);
  const precisionDefects = Object.entries(precision).filter(([, count]) => count > 0);
  if (precisionDefects.length > 0) {
    findings.push({
      verdict: 'member-precision-defect',
      detail: precisionDefects.map(([check, count]) => `${check}=${count}`).join(', '),
    });
  }

  const unmaterialized = unmaterializedMembershipKeys(evidence);
  if (unmaterialized.length > 0) {
    findings.push({
      verdict: 'membership-not-materialized',
      detail: `${unmaterialized.length} membership key(s) in the latest stored snapshot carry no live source-owned CURRENT row`,
    });
  }

  if (snapshotExpired(evidence, now)) {
    findings.push({
      verdict: 'snapshot-expired',
      detail: `the stored snapshot expired at ${evidence.storedFreshnessExpiresAt}, so serve suppresses its ${evidence.expiredMaterializedRows} row(s) and the page shows no roster until the source runs again`,
    });
  }

  const uncovered = uncoveredCurrentSections(evidence);
  if (uncovered.length > 0) {
    findings.push({
      verdict: 'uncovered-section',
      detail: `${uncovered.length} member-listing section(s) no config claims: ${uncovered.join(', ')}`,
    });
  }

  if (findings.length === 0) {
    return {
      verdict: 'ok',
      detail: `state ${evidence.state}, ${evidence.members.length} member(s) across ${evidence.configuredSections.length} configured section(s), ${evidence.withheldCount} withheld`,
    };
  }
  findings.sort(
    (left, right) =>
      VERDICT_SEVERITY.indexOf(left.verdict) - VERDICT_SEVERITY.indexOf(right.verdict),
  );
  return {
    verdict: findings[0]!.verdict,
    detail: findings.map((finding) => finding.detail).join('; '),
  };
}

export interface OfficialRosterAuditRow {
  researchEntityKey: string;
  url: string;
  verdict: OfficialRosterVerdict;
  detail: string;
  state: OfficialRosterLaneEvidence['state'];
  reachability: SourceLinkHealthStatus;
  membersOnPage: number;
  withheldCount: number;
  duplicateCount: number;
  configuredSections: string[];
  missingConfiguredSections: string[];
  uncoveredSections: string[];
  precision: OfficialRosterPrecision;
  storedMembershipKeys: number;
  materializedMembershipKeys: number;
  unmaterializedMembershipKeys: number;
  expiredMaterializedRows: number;
  snapshotExpired: boolean;
  snapshotDrift: OfficialRosterSnapshotDrift;
  sourcePublishedAt?: string;
  publishAgeDays?: number;
  daysUntilPublishAgeCeiling?: number;
  landedUrl?: string;
  error?: string;
}

/**
 * A precision sample row. Reviewing role mapping means reading a person's own
 * title, so these carry names and go only into the write-guarded `--output` file,
 * never to stdout, the same rule `scrape run --explain` follows.
 */
export interface OfficialRosterSampleRow {
  researchEntityKey: string;
  name: string;
  title: string;
  role: string;
  sectionLabel: string;
  profileUrl: string;
}

export interface ResearchHomeRosterAuditReport {
  status: 'ok' | 'findings';
  broadEnablementReady: boolean;
  sampledPrecisionReviewedBy?: string;
  lanesAudited: number;
  membersOnPage: number;
  verdictCounts: Record<OfficialRosterVerdict, number>;
  /** Lanes whose verdict means the acquisition path is defective. */
  brokenLanes: number;
  expiredSnapshots: number;
  unmaterializedMembershipKeys: number;
  lanes: OfficialRosterAuditRow[];
  sample?: OfficialRosterSampleRow[];
}

export function buildOfficialRosterSample(
  evidence: readonly OfficialRosterLaneEvidence[],
  sampleLimit: number,
): OfficialRosterSampleRow[] {
  if (sampleLimit <= 0) return [];
  const rows: OfficialRosterSampleRow[] = [];
  for (const lane of evidence) {
    for (const member of lane.members) {
      if (rows.length >= sampleLimit) return rows;
      rows.push({
        researchEntityKey: lane.researchEntityKey,
        name: member.name,
        title: member.title,
        role: member.role,
        sectionLabel: member.sectionLabel,
        profileUrl: member.profileUrl,
      });
    }
  }
  return rows;
}

export function summarizeResearchHomeRosterAudit(
  evidence: readonly OfficialRosterLaneEvidence[],
  options: { sampledPrecisionReviewedBy?: string; sampleLimit?: number; now?: Date } = {},
): ResearchHomeRosterAuditReport {
  const now = options.now ?? new Date();
  const verdictCounts = Object.fromEntries(
    VERDICT_SEVERITY.map((verdict) => [verdict, 0]),
  ) as Record<OfficialRosterVerdict, number>;

  const lanes: OfficialRosterAuditRow[] = evidence.map((lane) => {
    const finding = classifyOfficialRosterLane(lane, now);
    verdictCounts[finding.verdict] += 1;
    return {
      researchEntityKey: lane.researchEntityKey,
      url: lane.url,
      verdict: finding.verdict,
      detail: finding.detail,
      state: lane.state,
      reachability: lane.reachability,
      membersOnPage: lane.members.length,
      withheldCount: lane.withheldCount,
      duplicateCount: lane.duplicateCount,
      configuredSections: [...lane.configuredSections],
      missingConfiguredSections: missingConfiguredSections(lane),
      uncoveredSections: uncoveredCurrentSections(lane),
      precision: officialRosterPrecision(lane),
      storedMembershipKeys: lane.storedMembershipKeys.length,
      materializedMembershipKeys: lane.materializedMembershipKeys.length,
      unmaterializedMembershipKeys: unmaterializedMembershipKeys(lane).length,
      expiredMaterializedRows: lane.expiredMaterializedRows,
      snapshotExpired: snapshotExpired(lane, now),
      snapshotDrift: snapshotDrift(lane),
      ...(lane.sourcePublishedAt ? { sourcePublishedAt: lane.sourcePublishedAt } : {}),
      ...(lane.publishAgeDays !== undefined ? { publishAgeDays: lane.publishAgeDays } : {}),
      ...(lane.daysUntilPublishAgeCeiling !== undefined
        ? { daysUntilPublishAgeCeiling: lane.daysUntilPublishAgeCeiling }
        : {}),
      ...(lane.landedUrl ? { landedUrl: lane.landedUrl } : {}),
      ...(lane.error ? { error: lane.error } : {}),
    };
  });

  lanes.sort((left, right) => {
    const bySeverity =
      VERDICT_SEVERITY.indexOf(left.verdict) - VERDICT_SEVERITY.indexOf(right.verdict);
    return bySeverity !== 0
      ? bySeverity
      : left.researchEntityKey.localeCompare(right.researchEntityKey);
  });

  const brokenLanes = lanes.filter((lane) => ALARMING_VERDICTS.includes(lane.verdict)).length;
  const reviewer = options.sampledPrecisionReviewedBy?.trim();
  const sample = buildOfficialRosterSample(evidence, options.sampleLimit ?? 0);

  return {
    status: brokenLanes === 0 ? 'ok' : 'findings',
    // The docs gate broad enablement on both halves: a clean structural report and
    // a recorded sampled precision review. A clean report alone has never been the
    // criterion, because structure cannot tell whether a mapped role is honest.
    broadEnablementReady: brokenLanes === 0 && Boolean(reviewer),
    ...(reviewer ? { sampledPrecisionReviewedBy: reviewer } : {}),
    lanesAudited: lanes.length,
    membersOnPage: lanes.reduce((total, lane) => total + lane.membersOnPage, 0),
    verdictCounts,
    brokenLanes,
    expiredSnapshots: lanes.filter((lane) => lane.snapshotExpired).length,
    unmaterializedMembershipKeys: lanes.reduce(
      (total, lane) => total + lane.unmaterializedMembershipKeys,
      0,
    ),
    lanes,
    ...(sample.length > 0 ? { sample } : {}),
  };
}
