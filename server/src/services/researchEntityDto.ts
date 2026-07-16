import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';

const MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS = 100;
const MAX_PUBLIC_RESEARCH_ENTITY_URLS = 50;
const MAX_PUBLIC_RESEARCH_ENTITY_OBJECT_KEYS = 100;
const MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH = 5000;

export interface PublicResearchEntityDto extends Record<string, unknown> {
  _id: string;
  id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  entityKind?: string;
  entityType?: string;
  departments: string[];
  researchAreas: string[];
  sourceUrls: string[];
}

function publicResearchEntityId(group: Record<string, any>): string {
  const slug = publicTextString(group.slug || '');
  if (slug) return slug;
  return publicTextString(group.name || group.displayName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS)
    .map((item) => String(item).slice(0, MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH))
    .filter(Boolean);
}

function publicTextString(value: unknown): string {
  const text = String(value || '').slice(0, MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH);
  return redactDirectContactInfo(text);
}

function publicTextStringArray(value: unknown): string[] {
  return stringArray(value).map(publicTextString).filter(Boolean);
}

function publicHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    if (!isPublicHttpUrl(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function publicHttpUrlArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PUBLIC_RESEARCH_ENTITY_URLS)
    .flatMap((item) => publicHttpUrl(item) ?? []);
}

const PREFIXED_DEPARTMENT_PATTERN = /^([A-Za-z&/]+)\s*-\s*(.+)$/;

function departmentDisplayLabel(department: string): string {
  const value = department.trim();
  const match = value.match(PREFIXED_DEPARTMENT_PATTERN);
  return match ? match[2].trim() : value;
}

function normalizedDepartmentLabel(department: string): string {
  return departmentDisplayLabel(department)
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function publicDepartmentArray(value: unknown): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const department of stringArray(value)) {
    const label = publicTextString(departmentDisplayLabel(department));
    const key = normalizedDepartmentLabel(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

const OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS = [
  'description',
  'shortDescription',
  'fullDescription',
  'profileSynthesisDescription',
  'descriptionSource',
  'website',
  'websiteUrl',
  'location',
  'school',
  'schools',
  'openness',
  'acceptingUndergrads',
  'currentUndergradCount',
  'undergradEvidenceQuote',
  'pastUndergradAdvisees',
  'offersIndependentStudy',
  'independentStudyCourses',
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
  'recentPaperCount',
  'lastPaperAtCache',
  'lastGrantAtCache',
  'activePaperCount2yCache',
  'typicalUndergradRoles',
  'prerequisiteCourses',
  'creditOptions',
  'fundingPrograms',
  'studentDecisionExplanation',
  'timeCommitmentHoursPerWeek',
  'acceptanceConfidence',
  'lastObservedAt',
  'hasActiveListing',
  'accessSummary',
  'searchMatch',
  'waysIn',
  'profileResearchAreas',
  'researchAreaSource',
] as const;

const OPERATOR_PUBLIC_RESEARCH_ENTITY_FIELDS = [
  'qualitySummary',
  'studentVisibilityTier',
] as const;

export interface PublicResearchEntityDtoOptions {
  includeOperatorFields?: boolean;
}

function publicTextValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactDirectContactInfo(value.slice(0, MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH));
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS).map(publicTextValue);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .slice(0, MAX_PUBLIC_RESEARCH_ENTITY_OBJECT_KEYS)
        .map((key) => [key, publicTextValue(source[key])]),
    );
  }
  return value;
}

/**
 * Public DTO for the canonical ResearchEntity API.
 */
export function toPublicResearchEntityDto(
  group: Record<string, any>,
  options: PublicResearchEntityDtoOptions = {},
): PublicResearchEntityDto {
  const id = publicResearchEntityId(group);
  const kind = group.kind;
  const entityType = group.entityType || mapResearchGroupKindToEntityType(kind);

  const dto: PublicResearchEntityDto = {
    _id: id,
    id,
    slug: publicTextString(group.slug || ''),
    name: publicTextString(group.name || group.displayName || ''),
    displayName: group.displayName === undefined ? undefined : publicTextString(group.displayName),
    kind,
    entityKind: kind,
    entityType,
    departments: publicDepartmentArray(group.departments),
    researchAreas: publicTextStringArray(group.researchAreas),
    sourceUrls: publicHttpUrlArray(group.sourceUrls),
  };

  for (const field of OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS) {
    if (group[field] !== undefined) {
      if (field === 'website' || field === 'websiteUrl') {
        const url = publicHttpUrl(group[field]);
        if (url) dto[field] = url;
        continue;
      }
      dto[field] = publicTextValue(group[field]);
    }
  }

  if (options.includeOperatorFields) {
    for (const field of OPERATOR_PUBLIC_RESEARCH_ENTITY_FIELDS) {
      if (group[field] !== undefined) {
        dto[field] = publicTextValue(group[field]);
      }
    }
  }

  return dto;
}

export function addResearchEntitySearchAliases<T extends { hits: Record<string, any>[] }>(
  result: T,
  options: PublicResearchEntityDtoOptions = {},
): Omit<T, 'hits'> & {
  researchEntities: PublicResearchEntityDto[];
} {
  const researchEntities = (result.hits || []).map((hit) =>
    toPublicResearchEntityDto(hit, options),
  );
  const { hits: _hits, ...rest } = result;
  return {
    ...rest,
    researchEntities,
  };
}

export function addResearchEntityDetailAlias<
  T extends { group: Record<string, any> },
>(
  detail: T,
  options: PublicResearchEntityDtoOptions = {},
): Omit<T, 'group'> & {
  researchEntity: PublicResearchEntityDto;
} {
  const researchEntity = toPublicResearchEntityDto(detail.group, options);
  const { group: _group, ...rest } = detail;
  return {
    ...rest,
    researchEntity,
  };
}
