import {
  isInstitutionSectionLandingUrl,
  isSharedEvidenceUrl,
  normalizeEvidenceUrl,
} from '../scrapers/utils/sharedEvidenceUrls';
import { isPersonProfileOrDirectoryUrl } from '../utils/researchHomeWebsiteUrl';

/**
 * Why a served description's cited page is not about the row serving it.
 *
 * `shared_evidence_page` and `institution_section_landing` are the two refusals
 * `labMicrositeDescriptionLLMExtractor` applies at write time (#3162). Asking them of
 * the stored corpus instead answers the question that refusal cannot: how many rows
 * were written before it, and how many came from a lane that never had it.
 */
export const DESCRIPTION_SOURCE_OWNERSHIP_VERDICTS = [
  'owned',
  'shared_evidence_page',
  'institution_section_landing',
  'no_cited_page',
  'no_description',
] as const;

export type DescriptionSourceOwnershipVerdict =
  (typeof DESCRIPTION_SOURCE_OWNERSHIP_VERDICTS)[number];

export interface DescriptionSourceOwnershipRow {
  slug: string;
  entityType?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  fieldProvenance?: unknown;
}

export interface DescriptionSourceOwnershipFinding {
  slug: string;
  entityType: string;
  verdict: DescriptionSourceOwnershipVerdict;
  citedUrl: string;
  lane: string;
  observedAt: string;
  descriptionHead: string;
  /**
   * How many live rows cite this page. Two is usually one subject stored twice, which
   * is a duplicate-row defect surfacing here rather than a borrowed description; twenty
   * is a directory or landing page and cannot be about any single row. Reported so a
   * reader can tell those apart instead of the audit guessing.
   */
  citedPageRowCount: number;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const provenanceFor = (row: DescriptionSourceOwnershipRow, field: string): Record<string, any> => {
  const provenance = row.fieldProvenance;
  if (!provenance || typeof provenance !== 'object') return {};
  const entry = (provenance as Record<string, any>)[field];
  return entry && typeof entry === 'object' ? entry : {};
};

/**
 * The verdict for one row's served long description.
 *
 * A person's own profile is exempt from the shared-page refusal for the same reason
 * the lane exempts it: a profile is cited by both that person's LAB row and their
 * research-area row, and it describes both.
 */
export function classifyDescriptionSourceOwnership(
  row: DescriptionSourceOwnershipRow,
  sharedUrls: ReadonlySet<string>,
  institutionalHosts: ReadonlySet<string>,
  citersByUrl: ReadonlyMap<string, number> = new Map(),
): DescriptionSourceOwnershipFinding {
  const entityType = textValue(row.entityType);
  const description = textValue(row.fullDescription) || textValue(row.shortDescription);
  const provenance = textValue(row.fullDescription)
    ? provenanceFor(row, 'fullDescription')
    : provenanceFor(row, 'shortDescription');
  const citedUrl = normalizeEvidenceUrl(provenance.sourceUrl);
  const base = {
    slug: row.slug,
    entityType,
    citedUrl,
    lane: textValue(provenance.sourceName),
    observedAt: provenance.observedAt ? String(provenance.observedAt) : '',
    descriptionHead: description.slice(0, 120),
    citedPageRowCount: citersByUrl.get(citedUrl) ?? 0,
  };

  if (!description) return { ...base, verdict: 'no_description' };
  if (!citedUrl) return { ...base, verdict: 'no_cited_page' };
  if (isInstitutionSectionLandingUrl(citedUrl, institutionalHosts)) {
    return { ...base, verdict: 'institution_section_landing' };
  }
  if (isSharedEvidenceUrl(citedUrl, sharedUrls) && !isPersonProfileOrDirectoryUrl(citedUrl)) {
    return { ...base, verdict: 'shared_evidence_page' };
  }
  return { ...base, verdict: 'owned' };
}

export interface DescriptionSourceOwnershipReport {
  rows: number;
  byVerdict: Record<string, number>;
  byLane: Record<string, number>;
  byEntityType: Record<string, number>;
  reusedCitedUrls: Array<{ url: string; rows: number }>;
  unownedBeforeGuard: number;
  unownedAfterGuard: number;
}

/** The day `#3162` began refusing these at write time. */
export const DESCRIPTION_OWNERSHIP_GUARD_LANDED = '2026-09-23T00:00:00.000Z';

const bump = (counter: Record<string, number>, key: string) => {
  counter[key] = (counter[key] || 0) + 1;
};

export function buildDescriptionSourceOwnershipReport(
  findings: readonly DescriptionSourceOwnershipFinding[],
): DescriptionSourceOwnershipReport {
  const byVerdict: Record<string, number> = {};
  const byLane: Record<string, number> = {};
  const byEntityType: Record<string, number> = {};
  const urlRows = new Map<string, number>();
  const guard = new Date(DESCRIPTION_OWNERSHIP_GUARD_LANDED).getTime();
  let unownedBeforeGuard = 0;
  let unownedAfterGuard = 0;

  for (const finding of findings) {
    bump(byVerdict, finding.verdict);
    const unowned =
      finding.verdict === 'shared_evidence_page' ||
      finding.verdict === 'institution_section_landing';
    if (!unowned) continue;
    bump(byLane, finding.lane || '(none)');
    bump(byEntityType, finding.entityType || '(none)');
    urlRows.set(finding.citedUrl, (urlRows.get(finding.citedUrl) || 0) + 1);
    const at = finding.observedAt ? new Date(finding.observedAt).getTime() : NaN;
    if (Number.isNaN(at)) continue;
    if (at < guard) unownedBeforeGuard += 1;
    else unownedAfterGuard += 1;
  }

  return {
    rows: findings.length,
    byVerdict,
    byLane,
    byEntityType,
    reusedCitedUrls: [...urlRows.entries()]
      .filter(([, rows]) => rows > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([url, rows]) => ({ url, rows })),
    unownedBeforeGuard,
    unownedAfterGuard,
  };
}
