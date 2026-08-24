import { searchResearchGroupsViaMeili } from './researchGroupService';
import type { ResearchGroupFilterInput } from './researchGroupFilters';
import type { PublicResearchEntityDto } from './researchEntityDto';

const MAX_DEPARTMENT_RESEARCH_ENTITIES = 100;

export interface DepartmentResearchPage {
  department: string;
  slug: string;
  entities: PublicResearchEntityDto[];
  estimatedTotalHits: number;
}

export function slugifyDepartmentName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function resolveCanonicalDepartmentName(slug: string): Promise<string | null> {
  const result = await searchResearchGroupsViaMeili('', {}, 1, 1, {}, { includeNonPublic: false });
  const departmentCounts = result.facetDistribution?.departments || {};
  for (const name of Object.keys(departmentCounts)) {
    if (slugifyDepartmentName(name) === slug) return name;
  }
  return null;
}

export async function getDepartmentResearchPage(
  rawSlug: string,
): Promise<DepartmentResearchPage | null> {
  const slug = slugifyDepartmentName(rawSlug);
  if (!slug) return null;

  const canonicalDepartment = await resolveCanonicalDepartmentName(slug);
  if (!canonicalDepartment) return null;

  const filters: ResearchGroupFilterInput = { departments: [canonicalDepartment] };
  const result = await searchResearchGroupsViaMeili(
    '',
    filters,
    1,
    MAX_DEPARTMENT_RESEARCH_ENTITIES,
    {},
    { includeNonPublic: false },
  );

  return {
    department: canonicalDepartment,
    slug,
    entities: result.researchEntities,
    estimatedTotalHits: result.estimatedTotalHits,
  };
}
