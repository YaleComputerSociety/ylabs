import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';

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

/**
 * Public DTO for the canonical ResearchEntity API.
 */
export function toPublicResearchEntityDto(group: Record<string, any>): PublicResearchEntityDto {
  const id = stringId(group._id || group.id);
  const kind = group.kind;
  const entityType = group.entityType || mapResearchGroupKindToEntityType(kind);

  return {
    ...group,
    _id: id,
    id,
    slug: group.slug || '',
    name: group.name || group.displayName || '',
    displayName: group.displayName,
    kind,
    entityKind: kind,
    entityType,
    departments: stringArray(group.departments),
    researchAreas: stringArray(group.researchAreas),
    sourceUrls: stringArray(group.sourceUrls),
  };
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
