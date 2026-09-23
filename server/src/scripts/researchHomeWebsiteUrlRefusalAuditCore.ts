import {
  researchHomeWebsiteUrlDecision,
  type CustomYaleResearchHomeSubdomainRefusal,
  type ResearchEntityHostOwnerIdentity,
  type ResearchHomeWebsiteUrlRefusal,
} from '../utils/researchHomeWebsiteUrl';

/**
 * Host shapes the path-vocabulary arm declines while the URL is still, in the
 * ordinary case, the entity's real research home.
 *
 * `environment.yale.edu/research/centers/<name>` is a centre's own page and
 * `www.cs.yale.edu/homes/<person>/` is a personal research page on a department's
 * legacy host; neither contains `lab`, `labs`, `project` or `group`, which is the
 * whole vocabulary the arm knows. The vocabulary was written for labs and never
 * extended to the other organization shapes, so a refusal here is a gap in the
 * rule rather than a claim about the URL.
 *
 * `directory-host` is excluded deliberately: `faculty.som.yale.edu/<person>` is a
 * faculty directory, which is never any entity's research home, so that refusal is
 * a real finding.
 */
const UNTAUGHT_HOST_SHAPES: ReadonlySet<CustomYaleResearchHomeSubdomainRefusal> = new Set([
  'school-or-department-subdomain',
  'www-plus-school',
  'unshared-trailing-label',
]);

export interface WebsiteUrlRefusalRow {
  websiteUrl?: unknown;
  entityType?: unknown;
  kind?: unknown;
  name?: unknown;
  displayName?: unknown;
}

export type RefusalVerdict = 'defect' | 'untaught-shape';

export interface WebsiteUrlRefusalFinding {
  reason: ResearchHomeWebsiteUrlRefusal;
  hostShape?: CustomYaleResearchHomeSubdomainRefusal;
  verdict: RefusalVerdict;
  entityType: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function refusalLabel(finding: {
  reason: ResearchHomeWebsiteUrlRefusal;
  hostShape?: CustomYaleResearchHomeSubdomainRefusal;
}): string {
  return finding.hostShape ? `${finding.reason}/${finding.hostShape}` : finding.reason;
}

/**
 * Whether a refusal is a claim about the URL or a gap in the rule.
 *
 * Every arm except the path vocabulary names a page shape that is never a research
 * home, so a refusal from one of them is a defect in the stored value. The path
 * vocabulary is the one arm whose refusal usually is not, and only for the host
 * shapes it was never taught.
 */
export function refusalVerdict(
  reason: ResearchHomeWebsiteUrlRefusal,
  hostShape?: CustomYaleResearchHomeSubdomainRefusal,
): RefusalVerdict {
  if (reason !== 'yale-path-vocabulary') return 'defect';
  return hostShape && UNTAUGHT_HOST_SHAPES.has(hostShape) ? 'untaught-shape' : 'defect';
}

export function auditWebsiteUrlRefusal(row: WebsiteUrlRefusalRow): WebsiteUrlRefusalFinding | null {
  const decision = researchHomeWebsiteUrlDecision(
    row.websiteUrl,
    row as ResearchEntityHostOwnerIdentity,
  );
  if (!decision.refusal) return null;
  return {
    reason: decision.refusal,
    ...(decision.hostShape ? { hostShape: decision.hostShape } : {}),
    verdict: refusalVerdict(decision.refusal, decision.hostShape),
    entityType: textValue(row.entityType) || '(none)',
  };
}

export interface WebsiteUrlRefusalReport {
  servedRowsWithWebsiteUrl: number;
  refused: number;
  defects: number;
  untaughtShapes: number;
  byLabel: Record<string, { count: number; verdict: RefusalVerdict }>;
  defectsByLabel: Record<string, number>;
  byEntityType: Record<string, { defects: number; untaughtShapes: number }>;
}

/**
 * The count the audit exists to publish is `defects`, not `refused`. A repair pass
 * keyed on `refused` would clear the served website of every row in the
 * `untaught-shape` buckets, and because a cleared row is indistinguishable from a
 * row that never had one, the loss would not be visible afterwards (#2582).
 */
export function buildWebsiteUrlRefusalReport(
  rows: readonly WebsiteUrlRefusalRow[],
): WebsiteUrlRefusalReport {
  const report: WebsiteUrlRefusalReport = {
    servedRowsWithWebsiteUrl: 0,
    refused: 0,
    defects: 0,
    untaughtShapes: 0,
    byLabel: {},
    defectsByLabel: {},
    byEntityType: {},
  };

  for (const row of rows) {
    if (!textValue(row.websiteUrl)) continue;
    report.servedRowsWithWebsiteUrl += 1;
    const finding = auditWebsiteUrlRefusal(row);
    if (!finding) continue;
    report.refused += 1;
    const label = refusalLabel(finding);
    const bucket = report.byLabel[label] ?? { count: 0, verdict: finding.verdict };
    bucket.count += 1;
    report.byLabel[label] = bucket;
    const typeBucket = report.byEntityType[finding.entityType] ?? {
      defects: 0,
      untaughtShapes: 0,
    };
    if (finding.verdict === 'defect') {
      report.defects += 1;
      report.defectsByLabel[label] = (report.defectsByLabel[label] ?? 0) + 1;
      typeBucket.defects += 1;
    } else {
      report.untaughtShapes += 1;
      typeBucket.untaughtShapes += 1;
    }
    report.byEntityType[finding.entityType] = typeBucket;
  }

  return report;
}
