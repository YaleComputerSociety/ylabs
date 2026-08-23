import {
  SCHOOL_PROFILE_HOSTS,
  applyResearchEntityOrgUnitCanonicalization,
} from '../scrapers/orgUnitCanonicalization';

export const SCHOOL_PROFILE_HOST_BACKFILL_SOURCE = 'school-profile-host-backfill';

export interface SchoolProfileHostEntity {
  id: string;
  slug?: string;
  name?: string;
  entityType?: string;
  school?: unknown;
  schools?: unknown;
  departments?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function hostnameOf(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function candidateProfileUrls(entity: SchoolProfileHostEntity): string[] {
  return [
    ...(typeof entity.websiteUrl === 'string' && entity.websiteUrl ? [entity.websiteUrl] : []),
    ...asStringArray(entity.sourceUrls),
  ];
}

function hasEmptySchool(entity: SchoolProfileHostEntity): boolean {
  const scalar = typeof entity.school === 'string' ? entity.school.trim() : '';
  return scalar === '' && asStringArray(entity.schools).length === 0;
}

export interface SchoolProfileHostPlanRow {
  id: string;
  slug?: string;
  name?: string;
  entityType?: string;
  evidenceUrl: string;
  afterSchool: string;
  afterSchools: string[];
  update: Record<string, unknown>;
}

/**
 * Plans the school/schools backfill for one entity whose school and schools[]
 * are both empty, resolving the school from its own profile host. Returns null
 * when the entity already carries a school or when no profile host names a
 * school, so the pass only ever adds a school it can point at evidence for.
 */
export async function planSchoolProfileHostRow(
  entity: SchoolProfileHostEntity,
  observedAt: Date,
): Promise<SchoolProfileHostPlanRow | null> {
  if (!hasEmptySchool(entity)) return null;

  const profileUrls = candidateProfileUrls(entity);
  const evidenceUrl =
    profileUrls.find((url) => Boolean(SCHOOL_PROFILE_HOSTS[hostnameOf(url)])) || '';
  if (!evidenceUrl) return null;

  const set: Record<string, unknown> = { school: '' };
  await applyResearchEntityOrgUnitCanonicalization(
    set,
    { school: entity.school, departments: entity.departments },
    profileUrls,
  );

  const afterSchool = typeof set.school === 'string' ? set.school : '';
  const afterSchools = asStringArray(set.schools);
  if (!afterSchool || afterSchools.length === 0) return null;

  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    entityType: entity.entityType,
    evidenceUrl,
    afterSchool,
    afterSchools,
    update: {
      school: afterSchool,
      schools: afterSchools,
      'fieldProvenance.school': {
        sourceName: SCHOOL_PROFILE_HOST_BACKFILL_SOURCE,
        sourceUrl: evidenceUrl,
        observedAt,
        confidence: 0.9,
      },
      'confidenceByField.school': 0.9,
    },
  };
}

export interface SchoolProfileHostSummary {
  scanned: number;
  changed: number;
  bySchool: Record<string, number>;
}

export function summarizeSchoolProfileHost(
  rows: Array<SchoolProfileHostPlanRow | null>,
): SchoolProfileHostSummary {
  const bySchool: Record<string, number> = {};
  let changed = 0;
  for (const row of rows) {
    if (!row) continue;
    changed += 1;
    bySchool[row.afterSchool] = (bySchool[row.afterSchool] || 0) + 1;
  }
  return { scanned: rows.length, changed, bySchool };
}
