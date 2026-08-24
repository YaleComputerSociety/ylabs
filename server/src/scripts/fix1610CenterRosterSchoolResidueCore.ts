/**
 * Backfill for #1610: research entities sourced from a cross-cutting
 * center/institute roster (Wu Tsai Institute, etc.) carry a `school`/`schools`
 * value that was derived - at some prior materialization - from that center's
 * spanning `departments` seed (e.g. Wu Tsai -> Neuroscience/Psychology/MCDB)
 * rather than from the person's own evidence. #1055/#1390 already stripped the
 * leaked `departments` values themselves; this backfill recomputes the
 * downstream `school`/`schools` derived from them, which that fix left stale.
 *
 * A row is only planned when the current `school`/`schools` has no
 * `fieldProvenance.school` - the fingerprint of a value that was never
 * independently asserted by an observation, only derived by canonicalization.
 * Any entity with real provenance (a `dept-faculty-roster` hit, a school-host
 * profile URL, etc.) is left untouched. Recomputation reuses the same
 * `applyResearchEntityOrgUnitCanonicalization` the materializer runs on write,
 * against the entity's current (already-cleaned) `departments` and its
 * `websiteUrl`/`sourceUrls`, so a person with genuine School of Medicine
 * evidence (their own department, or a medicine.yale.edu profile) keeps it -
 * only the uncorroborated default is cleared.
 */
import { applyResearchEntityOrgUnitCanonicalization } from '../scrapers/orgUnitCanonicalization';

export interface CenterRosterSchoolResidueEntity {
  id: string;
  slug?: string;
  name?: string;
  school?: unknown;
  schools?: unknown;
  departments?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  fieldProvenance?: Record<string, unknown> | null;
}

export interface CenterRosterSchoolResiduePlanRow {
  id: string;
  slug?: string;
  name?: string;
  beforeSchool: string;
  afterSchool: string;
  beforeSchools: string[];
  afterSchools: string[];
  update: Record<string, unknown>;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function hasAssertedSchoolProvenance(entity: CenterRosterSchoolResidueEntity): boolean {
  const provenance = entity.fieldProvenance;
  if (!provenance || typeof provenance !== 'object') return false;
  return Boolean((provenance as Record<string, unknown>).school);
}

/**
 * The recomputed `school`/`schools` this entity's current (post-cleanup)
 * evidence supports, or null when the recorded value is already correct or the
 * entity has an independently asserted school this backfill must not touch.
 */
export async function planCenterRosterSchoolResidueRow(
  entity: CenterRosterSchoolResidueEntity,
): Promise<CenterRosterSchoolResiduePlanRow | null> {
  if (hasAssertedSchoolProvenance(entity)) return null;

  const beforeSchool = typeof entity.school === 'string' ? entity.school : '';
  const beforeSchools = asStringArray(entity.schools);
  if (!beforeSchool && beforeSchools.length === 0) return null;

  const set: Record<string, unknown> = {
    school: '',
    schools: [],
    departments: asStringArray(entity.departments),
  };
  const profileUrls = [
    ...(typeof entity.websiteUrl === 'string' && entity.websiteUrl ? [entity.websiteUrl] : []),
    ...asStringArray(entity.sourceUrls),
  ];
  await applyResearchEntityOrgUnitCanonicalization(set, null, profileUrls);

  const afterSchool = typeof set.school === 'string' ? set.school : '';
  const afterSchools = asStringArray(set.schools);

  if (afterSchool === beforeSchool && sameStringArray(afterSchools, beforeSchools)) return null;

  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    beforeSchool,
    afterSchool,
    beforeSchools,
    afterSchools,
    update: {
      school: afterSchool,
      schools: afterSchools,
    },
  };
}

export interface CenterRosterSchoolResidueSummary {
  scanned: number;
  changed: number;
  clearedToUnset: number;
}

export function summarizeCenterRosterSchoolResidue(
  rows: Array<CenterRosterSchoolResiduePlanRow | null>,
): CenterRosterSchoolResidueSummary {
  const changed = rows.filter(
    (row): row is CenterRosterSchoolResiduePlanRow => row !== null,
  );
  return {
    scanned: rows.length,
    changed: changed.length,
    clearedToUnset: changed.filter((row) => !row.afterSchool && row.afterSchools.length === 0)
      .length,
  };
}
