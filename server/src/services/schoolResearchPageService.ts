/**
 * Canonical per-school research page aggregation (issue #1707).
 *
 * School sits one level above department in the org hierarchy
 * (school -> department -> home). This composes already-materialized, already-
 * gated `student_ready` ResearchEntity records for one school into a single
 * view: the school's departments with per-department home counts, its cross-
 * cutting centers and institutes, a representative set of research homes, and
 * the school-wide documented ways in. It mints no new signal and changes no
 * gating; it only reshapes what browse already serves.
 *
 * The school is resolved through the shared OrgUnit canonicalizer
 * (`orgUnitCanonicalization.ts`, SCHOOL_KINDS) rather than a second hardcoded
 * school list, and fails closed on any slug that does not resolve to a known
 * SCHOOL/DIVISION OrgUnit - consistent with the ingest-time canonicalizer.
 *
 * Aggregation is a direct, index-backed Mongo read (school + student_ready +
 * non-archived), not a Meili query: a school page wants deterministic
 * completeness over one known school rather than free-text relevance, and must
 * not depend on the search index being synced.
 */
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { researchEntityTypes } from '../models/researchAccessTypes';
import { researchEntityHasDeceasedLead } from '../utils/researchEntityDeceasedLead';
import { disambiguateCollidingResearchEntityNames } from '../utils/researchEntityDisplayNameDisambiguation';
import {
  getOrgUnitCanonicalizer,
  orgUnitMatchKey,
} from '../scrapers/orgUnitCanonicalization';
import {
  departmentDisplayLabel,
  isYaleSchoolLabelKey,
  normalizedDepartmentLabelKey,
  toDepartmentSlug,
} from '../utils/departmentSlug';
import { schoolSlugToQuery, toSchoolSlug } from '../utils/schoolSlug';
import {
  toPublicResearchEntityDto,
  type PublicResearchEntityDto,
} from './researchEntityDto';

const MAX_SCHOOL_ENTITIES = 800;
const MAX_ENTITIES_PER_GROUP = 60;
const MAX_WAY_IN_ENTITIES = 60;
const MAX_DEPARTMENTS = 60;

const WAY_IN_ENTITY_TYPES = ['COURSE_SEQUENCE', 'RA_PROGRAM', 'FELLOWSHIP_PROGRAM'] as const;
const WAY_IN_ENTITY_TYPE_SET = new Set<string>(WAY_IN_ENTITY_TYPES);

const CROSS_CUTTING_ENTITY_TYPES = ['CENTER', 'INSTITUTE'] as const;
const CROSS_CUTTING_ENTITY_TYPE_SET = new Set<string>(CROSS_CUTTING_ENTITY_TYPES);

const HOME_ENTITY_TYPE_ORDER = researchEntityTypes.filter(
  (type) => !WAY_IN_ENTITY_TYPE_SET.has(type) && !CROSS_CUTTING_ENTITY_TYPE_SET.has(type),
);

const ENTITY_TYPE_GROUP_LABELS: Record<string, string> = {
  LAB: 'Labs',
  CENTER: 'Centers',
  INSTITUTE: 'Institutes',
  FACULTY_RESEARCH_AREA: 'Faculty research areas',
  FACULTY_PROJECT: 'Faculty projects',
  DIGITAL_HUMANITIES_PROJECT: 'Digital humanities projects',
  COLLECTIONS_INITIATIVE: 'Collections initiatives',
  ARCHIVE_OR_MUSEUM_PROJECT: 'Archives and museum projects',
  PROGRAM: 'Programs',
  INITIATIVE: 'Initiatives',
  GROUP: 'Research groups',
  INDIVIDUAL_RESEARCH: 'Individual research',
  CORE_FACILITY: 'Core facilities',
  RA_PROGRAM: 'Research assistant programs',
  FELLOWSHIP_PROGRAM: 'Fellowships',
  COURSE_SEQUENCE: 'Directed research and course pathways',
};

function entityTypeGroupLabel(entityType: string): string {
  const known = ENTITY_TYPE_GROUP_LABELS[entityType];
  if (known) return known;
  return entityType
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());
}

const titleCaseLabel = (label: string): string =>
  label.replace(/\b\w/g, (char) => char.toUpperCase());

export interface SchoolResearchEntityGroup {
  entityType: string;
  label: string;
  researchEntities: PublicResearchEntityDto[];
  totalCount: number;
}

export interface SchoolDepartmentSummary {
  slug: string;
  label: string;
  homeCount: number;
}

export interface SchoolResearchPage {
  school: {
    slug: string;
    label: string;
  };
  departments: SchoolDepartmentSummary[];
  crossCuttingGroups: SchoolResearchEntityGroup[];
  homeGroups: SchoolResearchEntityGroup[];
  waysIn: SchoolResearchEntityGroup[];
  totalHomeCount: number;
  totalWayInCount: number;
}

export interface ResolvedSchool {
  slug: string;
  name: string;
}

/**
 * Resolve a raw URL slug to its canonical school through the shared OrgUnit
 * canonicalizer, or null when the slug is malformed or does not resolve to a
 * known SCHOOL/DIVISION OrgUnit. Fails closed: an unknown school is never a
 * valid per-school destination.
 */
export async function resolveSchoolSlug(rawSlug: unknown): Promise<ResolvedSchool | null> {
  const query = schoolSlugToQuery(rawSlug);
  if (!query) return null;
  const canonicalizer = await getOrgUnitCanonicalizer();
  const canonical = canonicalizer.canonicalizeSchool(query);
  if (!canonical.matched || !canonical.value.trim()) return null;
  return { slug: toSchoolSlug(canonical.value), name: canonical.value };
}

interface EntityLike extends Record<string, unknown> {
  entityType?: unknown;
  kind?: unknown;
  departments?: unknown;
}

function groupByEntityType(
  dtos: PublicResearchEntityDto[],
  orderedTypes: readonly string[],
  perGroupCap: number,
): { groups: SchoolResearchEntityGroup[]; total: number } {
  const byType = new Map<string, PublicResearchEntityDto[]>();
  for (const dto of dtos) {
    const entityType = typeof dto.entityType === 'string' ? dto.entityType : 'LAB';
    const bucket = byType.get(entityType);
    if (bucket) bucket.push(dto);
    else byType.set(entityType, [dto]);
  }

  const orderIndex = new Map(orderedTypes.map((type, index) => [type, index]));
  const groups: SchoolResearchEntityGroup[] = [];
  let total = 0;
  const sortedTypes = Array.from(byType.keys()).sort((a, b) => {
    const rankA = orderIndex.has(a) ? (orderIndex.get(a) as number) : orderedTypes.length;
    const rankB = orderIndex.has(b) ? (orderIndex.get(b) as number) : orderedTypes.length;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });

  for (const entityType of sortedTypes) {
    const entities = byType.get(entityType) as PublicResearchEntityDto[];
    entities.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    total += entities.length;
    groups.push({
      entityType,
      label: entityTypeGroupLabel(entityType),
      researchEntities: entities.slice(0, perGroupCap),
      totalCount: entities.length,
    });
  }

  return { groups, total };
}

/**
 * Roll the school's home entities up into a navigable department list with a
 * per-department home count. A department value that names the school itself is
 * skipped (#1384): a school is not a peer of a department, so the per-school
 * page never links back into a department slug that is really the school. The
 * most common display-label variant becomes the department title so the
 * per-department slug and label line up with the browse facet.
 */
function summarizeDepartments(dtos: PublicResearchEntityDto[]): SchoolDepartmentSummary[] {
  const counts = new Map<string, number>();
  const labelFrequency = new Map<string, Map<string, number>>();

  for (const dto of dtos) {
    const departments = Array.isArray(dto.departments) ? dto.departments : [];
    const seenForEntity = new Set<string>();
    for (const raw of departments) {
      if (typeof raw !== 'string') continue;
      const labelKey = normalizedDepartmentLabelKey(raw);
      if (!labelKey || isYaleSchoolLabelKey(labelKey)) continue;
      if (seenForEntity.has(labelKey)) continue;
      seenForEntity.add(labelKey);
      counts.set(labelKey, (counts.get(labelKey) || 0) + 1);
      const label = departmentDisplayLabel(raw).trim();
      if (!label) continue;
      const byLabel = labelFrequency.get(labelKey) ?? new Map<string, number>();
      byLabel.set(label, (byLabel.get(label) || 0) + 1);
      labelFrequency.set(labelKey, byLabel);
    }
  }

  const summaries: SchoolDepartmentSummary[] = [];
  for (const [labelKey, homeCount] of counts.entries()) {
    const byLabel = labelFrequency.get(labelKey);
    const label = byLabel
      ? Array.from(byLabel.entries()).sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          if (b[0].length !== a[0].length) return b[0].length - a[0].length;
          return a[0].localeCompare(b[0]);
        })[0][0]
      : titleCaseLabel(labelKey);
    summaries.push({ slug: toDepartmentSlug(labelKey), label, homeCount });
  }

  summaries.sort((a, b) => {
    if (b.homeCount !== a.homeCount) return b.homeCount - a.homeCount;
    return a.label.localeCompare(b.label);
  });

  return summaries.slice(0, MAX_DEPARTMENTS);
}

/**
 * Pure aggregation over already-fetched, already-servable entity docs. Kept
 * separate from the Mongo read so the grouping, department roll-up, ways-in
 * split, and empty-state shape are unit-testable without a database.
 */
export function buildSchoolResearchPage(
  resolved: ResolvedSchool,
  docs: EntityLike[],
): SchoolResearchPage {
  const dtos = disambiguateCollidingResearchEntityNames(
    docs.map((doc) => toPublicResearchEntityDto(doc, { forList: true })),
  );

  const wayInDtos = dtos.filter((dto) =>
    WAY_IN_ENTITY_TYPE_SET.has(String(dto.entityType || '')),
  );
  const nonWayInDtos = dtos.filter(
    (dto) => !WAY_IN_ENTITY_TYPE_SET.has(String(dto.entityType || '')),
  );
  const crossCuttingDtos = nonWayInDtos.filter((dto) =>
    CROSS_CUTTING_ENTITY_TYPE_SET.has(String(dto.entityType || '')),
  );
  const homeDtos = nonWayInDtos.filter(
    (dto) => !CROSS_CUTTING_ENTITY_TYPE_SET.has(String(dto.entityType || '')),
  );

  const crossCutting = groupByEntityType(
    crossCuttingDtos,
    CROSS_CUTTING_ENTITY_TYPES,
    MAX_ENTITIES_PER_GROUP,
  );
  const homes = groupByEntityType(homeDtos, HOME_ENTITY_TYPE_ORDER, MAX_ENTITIES_PER_GROUP);
  const waysIn = groupByEntityType(wayInDtos, WAY_IN_ENTITY_TYPES, MAX_WAY_IN_ENTITIES);

  return {
    school: { slug: resolved.slug, label: resolved.name },
    departments: summarizeDepartments(nonWayInDtos),
    crossCuttingGroups: crossCutting.groups,
    homeGroups: homes.groups,
    waysIn: waysIn.groups,
    totalHomeCount: crossCutting.total + homes.total,
    totalWayInCount: waysIn.total,
  };
}

/**
 * Resolve a school slug and aggregate its servable research homes, cross-cutting
 * centers, departments, and ways in. Returns null only when the slug is
 * malformed or does not resolve to a known school; a resolved school with no
 * coverage returns an honest empty page.
 */
export async function getSchoolResearchPage(
  rawSlug: unknown,
): Promise<SchoolResearchPage | null> {
  const resolved = await resolveSchoolSlug(rawSlug);
  if (!resolved) return null;

  const matchKey = orgUnitMatchKey(resolved.name);
  if (!matchKey) return null;

  const servableFilter = {
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  };

  const [distinctSchools, distinctScalarSchools] = await Promise.all([
    ResearchEntity.distinct('schools', servableFilter) as Promise<unknown[]>,
    ResearchEntity.distinct('school', servableFilter) as Promise<unknown[]>,
  ]);

  const matchingSchoolValues = Array.from(
    new Set(
      [...distinctSchools, ...distinctScalarSchools].filter(
        (value): value is string =>
          typeof value === 'string' && orgUnitMatchKey(value) === matchKey,
      ),
    ),
  );

  if (matchingSchoolValues.length === 0) {
    return buildSchoolResearchPage(resolved, []);
  }

  const docs = await ResearchEntity.find({
    ...servableFilter,
    $or: [{ schools: { $in: matchingSchoolValues } }, { school: { $in: matchingSchoolValues } }],
  })
    .limit(MAX_SCHOOL_ENTITIES)
    .lean();

  const servableDocs = (docs as EntityLike[]).filter(
    (doc) => !researchEntityHasDeceasedLead(doc as Record<string, any>),
  );

  return buildSchoolResearchPage(resolved, servableDocs);
}
