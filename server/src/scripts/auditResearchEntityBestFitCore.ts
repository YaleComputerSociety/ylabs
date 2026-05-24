import { publicResearchAreaArray } from '../services/researchEntityDto';

export type BestFitCoverageStatus =
  | 'usable'
  | 'missing'
  | 'genericOnly'
  | 'piFallbackOnly'
  | 'sparseProfile';

export interface BestFitAuditFacts {
  id: string;
  slug: string;
  name: string;
  archived?: boolean;
  descriptionSource?: string;
  researchAreas?: unknown;
  profileResearchAreas?: unknown;
  piProfileTerms?: unknown;
  researchAreaSource?: string;
}

export interface BestFitAuditRow {
  id: string;
  slug: string;
  name: string;
  status: BestFitCoverageStatus;
  researchAreas: string[];
  usableResearchAreas: string[];
  profileResearchAreas: string[];
  descriptionSource: string;
  researchAreaSource: string;
  issues: string[];
}

const normalizeKey = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

export function isGenericBestFitLabel(value: string): boolean {
  return (
    /^(yale\s+)?school of\b/i.test(value) ||
    /^yale school\b/i.test(value) ||
    /^yale faculty\b/i.test(value)
  );
}

function publicBestFitAreas(value: unknown): string[] {
  return publicResearchAreaArray(value).filter((area) => !isGenericBestFitLabel(area));
}

export function classifyBestFitCoverage(facts: BestFitAuditFacts): BestFitAuditRow {
  const researchAreas = publicResearchAreaArray(facts.researchAreas);
  const usableResearchAreas = researchAreas.filter((area) => !isGenericBestFitLabel(area));
  const profileResearchAreas = publicResearchAreaArray([
    ...publicResearchAreaArray(facts.profileResearchAreas),
    ...publicResearchAreaArray(facts.piProfileTerms),
  ]);
  const profileKeys = new Set(profileResearchAreas.map(normalizeKey));
  const descriptionSource = String(facts.descriptionSource || 'NONE');
  const researchAreaSource = String(facts.researchAreaSource || '');
  const issues: string[] = [];

  let status: BestFitCoverageStatus = 'usable';
  if (usableResearchAreas.length === 0) {
    if (descriptionSource === 'PI_PROFILE_SYNTHESIS') {
      status = 'sparseProfile';
      issues.push('SPARSE_PROFILE_FALLBACK');
    } else if (researchAreas.length > 0) {
      status = 'genericOnly';
      issues.push('GENERIC_ONLY_RESEARCH_AREAS');
    } else {
      status = 'missing';
      issues.push('NO_ENTITY_RESEARCH_AREAS');
    }
  } else if (
    profileKeys.size > 0 &&
    usableResearchAreas.every((area) => profileKeys.has(normalizeKey(area)))
  ) {
    status = 'piFallbackOnly';
    issues.push('PI_PROFILE_TERMS_ONLY');
  }

  return {
    id: facts.id,
    slug: facts.slug,
    name: facts.name,
    status,
    researchAreas,
    usableResearchAreas: publicBestFitAreas(usableResearchAreas),
    profileResearchAreas,
    descriptionSource,
    researchAreaSource,
    issues,
  };
}

export function summarizeBestFitCoverage(rows: BestFitAuditRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      summary[row.status] += 1;
      return summary;
    },
    {
      total: 0,
      usable: 0,
      missing: 0,
      genericOnly: 0,
      piFallbackOnly: 0,
      sparseProfile: 0,
    } as Record<BestFitCoverageStatus | 'total', number>,
  );
}
