import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import { publicContactEmail } from '../utils/contactEmail';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';

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

function stringId(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
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
  return value.flatMap((item) => publicHttpUrl(item) ?? []);
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
    const label = departmentDisplayLabel(department);
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
  'contactEmail',
  'contactName',
  'contactRole',
  'acceptanceConfidence',
  'lastObservedAt',
  'createdAt',
  'updatedAt',
  'hasActiveListing',
  'accessSummary',
  'searchMatch',
  'waysIn',
  'qualitySummary',
  'studentVisibilityTier',
  'profileResearchAreas',
  'researchAreaSource',
] as const;

const EVIDENCE_TEXT_FIELDS = new Set<string>(['undergradEvidenceQuote']);

/**
 * Public DTO for the canonical ResearchEntity API.
 */
export function toPublicResearchEntityDto(group: Record<string, any>): PublicResearchEntityDto {
  const id = stringId(group._id || group.id);
  const kind = group.kind;
  const entityType = group.entityType || mapResearchGroupKindToEntityType(kind);

  const dto: PublicResearchEntityDto = {
    _id: id,
    id,
    slug: group.slug || '',
    name: group.name || group.displayName || '',
    displayName: group.displayName,
    kind,
    entityKind: kind,
    entityType,
    departments: publicDepartmentArray(group.departments),
    researchAreas: stringArray(group.researchAreas),
    sourceUrls: publicHttpUrlArray(group.sourceUrls),
  };

  for (const field of OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS) {
    if (group[field] !== undefined) {
      if (field === 'website' || field === 'websiteUrl') {
        const url = publicHttpUrl(group[field]);
        if (url) dto[field] = url;
        continue;
      }
      if (field === 'contactEmail') {
        const email = publicContactEmail(group[field]);
        if (email) dto[field] = email;
        continue;
      }
      if (EVIDENCE_TEXT_FIELDS.has(field) && typeof group[field] === 'string') {
        dto[field] = redactDirectContactInfo(group[field]);
        continue;
      }
      dto[field] = group[field];
    }
  }

  return dto;
}

export function addResearchEntitySearchAliases<T extends { hits: Record<string, any>[] }>(
  result: T,
): Omit<T, 'hits'> & {
  researchEntities: PublicResearchEntityDto[];
} {
  const researchEntities = (result.hits || []).map(toPublicResearchEntityDto);
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
): Omit<T, 'group'> & {
  researchEntity: PublicResearchEntityDto;
} {
  const researchEntity = toPublicResearchEntityDto(detail.group);
  const { group: _group, ...rest } = detail;
  return {
    ...rest,
    researchEntity,
  };
}
