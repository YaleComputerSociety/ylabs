/**
 * Canonical per-department research page aggregation (issue #1649).
 *
 * Composes already-materialized, already-gated `student_ready` ResearchEntity
 * records for one department into a single view: research homes grouped by
 * `entityType`, plus a distinct "ways in" bucket of the department's documented
 * pathways (course sequences, RA programs, fellowship programs). It mints no new
 * signal and changes no gating; it only reshapes what browse already serves.
 *
 * Aggregation is a direct, index-backed Mongo read (department + student_ready +
 * non-archived), not a Meili query: a department page wants deterministic
 * completeness over one known department rather than free-text relevance, and
 * must not depend on the search index being synced.
 */
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { researchEntityTypes } from '../models/researchAccessTypes';
import { researchEntityHasDeceasedLead } from '../utils/researchEntityDeceasedLead';
import { disambiguateCollidingResearchEntityNames } from '../utils/researchEntityDisplayNameDisambiguation';
import {
  departmentDisplayLabel,
  departmentSlugToLabelKey,
  isYaleSchoolLabelKey,
  normalizedDepartmentLabelKey,
  toDepartmentSlug,
} from '../utils/departmentSlug';
import {
  toPublicResearchEntityDto,
  type PublicResearchEntityDto,
} from './researchEntityDto';

const MAX_DEPARTMENT_ENTITIES = 500;
const MAX_ENTITIES_PER_GROUP = 60;
const MAX_WAY_IN_ENTITIES = 60;

const WAY_IN_ENTITY_TYPES = ['COURSE_SEQUENCE', 'RA_PROGRAM', 'FELLOWSHIP_PROGRAM'] as const;
const WAY_IN_ENTITY_TYPE_SET = new Set<string>(WAY_IN_ENTITY_TYPES);

const HOME_ENTITY_TYPE_ORDER = researchEntityTypes.filter(
  (type) => !WAY_IN_ENTITY_TYPE_SET.has(type),
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

const titleCaseSlugLabel = (labelKey: string): string =>
  labelKey.replace(/\b\w/g, (char) => char.toUpperCase());

export interface DepartmentResearchEntityGroup {
  entityType: string;
  label: string;
  researchEntities: PublicResearchEntityDto[];
  totalCount: number;
}

export interface DepartmentResearchPage {
  department: {
    slug: string;
    label: string;
  };
  homeGroups: DepartmentResearchEntityGroup[];
  waysIn: DepartmentResearchEntityGroup[];
  totalHomeCount: number;
  totalWayInCount: number;
}

export interface ResolvedDepartmentSlug {
  slug: string;
  labelKey: string;
}

/**
 * Resolve a raw URL slug to its department comparison key, or null when the slug
 * is malformed or actually names a Yale school (never a valid per-department
 * destination, #1384).
 */
export function resolveDepartmentSlug(rawSlug: unknown): ResolvedDepartmentSlug | null {
  const labelKey = departmentSlugToLabelKey(rawSlug);
  if (!labelKey) return null;
  if (isYaleSchoolLabelKey(labelKey)) return null;
  return { slug: toDepartmentSlug(labelKey), labelKey };
}

interface EntityLike extends Record<string, unknown> {
  entityType?: unknown;
  kind?: unknown;
  departments?: unknown;
}

function preferredDepartmentLabel(
  labelKey: string,
  docs: EntityLike[],
): string {
  const frequency = new Map<string, number>();
  for (const doc of docs) {
    const rawDepartments = Array.isArray(doc.departments) ? doc.departments : [];
    for (const raw of rawDepartments) {
      if (typeof raw !== 'string') continue;
      if (normalizedDepartmentLabelKey(raw) !== labelKey) continue;
      const label = departmentDisplayLabel(raw).trim();
      if (!label) continue;
      frequency.set(label, (frequency.get(label) || 0) + 1);
    }
  }
  if (frequency.size === 0) return titleCaseSlugLabel(labelKey);
  return Array.from(frequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  })[0][0];
}

function groupByEntityType(
  dtos: PublicResearchEntityDto[],
  orderedTypes: readonly string[],
  perGroupCap: number,
): { groups: DepartmentResearchEntityGroup[]; total: number } {
  const byType = new Map<string, PublicResearchEntityDto[]>();
  for (const dto of dtos) {
    const entityType = typeof dto.entityType === 'string' ? dto.entityType : 'LAB';
    const bucket = byType.get(entityType);
    if (bucket) bucket.push(dto);
    else byType.set(entityType, [dto]);
  }

  const orderIndex = new Map(orderedTypes.map((type, index) => [type, index]));
  const groups: DepartmentResearchEntityGroup[] = [];
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
 * Pure aggregation over already-fetched, already-servable entity docs. Kept
 * separate from the Mongo read so the grouping, ways-in split, and empty-state
 * shape are unit-testable without a database.
 */
export function buildDepartmentResearchPage(
  resolved: ResolvedDepartmentSlug,
  docs: EntityLike[],
): DepartmentResearchPage {
  const label = preferredDepartmentLabel(resolved.labelKey, docs);
  const dtos = disambiguateCollidingResearchEntityNames(
    docs.map((doc) => toPublicResearchEntityDto(doc, { forList: true })),
  );

  const homeDtos = dtos.filter(
    (dto) => !WAY_IN_ENTITY_TYPE_SET.has(String(dto.entityType || '')),
  );
  const wayInDtos = dtos.filter((dto) =>
    WAY_IN_ENTITY_TYPE_SET.has(String(dto.entityType || '')),
  );

  const homes = groupByEntityType(homeDtos, HOME_ENTITY_TYPE_ORDER, MAX_ENTITIES_PER_GROUP);
  const waysIn = groupByEntityType(wayInDtos, WAY_IN_ENTITY_TYPES, MAX_WAY_IN_ENTITIES);

  return {
    department: { slug: resolved.slug, label },
    homeGroups: homes.groups,
    waysIn: waysIn.groups,
    totalHomeCount: homes.total,
    totalWayInCount: waysIn.total,
  };
}

/**
 * Resolve a department slug and aggregate its servable research homes and ways
 * in. Returns null only when the slug is malformed or names a school; a
 * well-formed department slug with no coverage returns an honest empty page.
 */
export async function getDepartmentResearchPage(
  rawSlug: unknown,
): Promise<DepartmentResearchPage | null> {
  const resolved = resolveDepartmentSlug(rawSlug);
  if (!resolved) return null;

  const servableFilter = {
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  };

  const distinctDepartments = (await ResearchEntity.distinct(
    'departments',
    servableFilter,
  )) as unknown[];
  const matchingRawDepartments = distinctDepartments.filter(
    (value): value is string =>
      typeof value === 'string' && normalizedDepartmentLabelKey(value) === resolved.labelKey,
  );

  if (matchingRawDepartments.length === 0) {
    return buildDepartmentResearchPage(resolved, []);
  }

  const docs = await ResearchEntity.find({
    ...servableFilter,
    departments: { $in: matchingRawDepartments },
  })
    .limit(MAX_DEPARTMENT_ENTITIES)
    .lean();

  const servableDocs = (docs as EntityLike[]).filter(
    (doc) => !researchEntityHasDeceasedLead(doc as Record<string, any>),
  );

  return buildDepartmentResearchPage(resolved, servableDocs);
}
