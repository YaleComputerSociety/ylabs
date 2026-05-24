import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  isResearchEntitySourceChromeText,
  sanitizeResearchEntityPublicDescriptionFields,
} from '../utils/researchEntityDescriptionText';
import {
  firstUsableResearchWebsiteUrl,
  isGenericResearchWebsiteIndexUrl,
  isUsableResearchWebsiteUrl,
} from '../utils/researchWebsiteUrl';
import { isPubliclyExposableSourceUrl } from '../utils/publicSourceUrl';
import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import type { PathwaySearchHit } from './pathwaySearchService';

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
  profileResearchAreas?: string[];
  researchAreaSource?: 'PI_PROFILE_FALLBACK';
  profileSynthesisDescription?: string;
  descriptionSource?: 'ENTITY_SOURCE' | 'PI_PROFILE_SYNTHESIS' | 'NONE';
  sourceUrls: string[];
  waysIn?: PathwaySearchHit[];
}

function stringId(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

export function publicResearchAreaArray(value: unknown): string[] {
  const seen = new Set<string>();
  const areas: string[] = [];
  const precleaned = stringArray(value).map(normalizePublicResearchAreaLabel);
  for (const item of sanitizeProfileResearchTerms(precleaned)) {
    const area = normalizePublicResearchAreaLabel(item);
    const key = area.toLowerCase();
    if (!area || seen.has(key) || isPollutedResearchAreaLabel(area)) continue;
    seen.add(key);
    areas.push(area);
  }
  return areas;
}

function normalizePublicResearchAreaLabel(value: string): string {
  const area = value.replace(/\s+/g, ' ').trim();
  const ysmTopicMatch = area.match(/^(.+?)\s*YSM Researchers?\s*View/i);
  if (!ysmTopicMatch) return area;

  const prefixWithCount = ysmTopicMatch[1].trim();
  const countMatch = prefixWithCount.match(/^(.*?)(\d{1,3})$/);
  if (!countMatch) return prefixWithCount;

  const [, stem, count] = countMatch;
  if (stem.endsWith('-') && count.length > 1) {
    return `${stem}${count[0]}`.trim();
  }
  return stem.trim();
}

function isPollutedResearchAreaLabel(value: string): boolean {
  if (value.length > 90) return true;
  if (/^\d+(?:[,.]\d+)*$/.test(value)) return true;
  if (/^[.\u00b7·…\s]+$/.test(value)) return true;
  if (/https?:\/\//i.test(value)) return true;
  if (isResearchEntitySourceChromeText(value)) return true;
  if (
    /\b(icon|streamline|view lab website|lab website|publications|citations|view full profile)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /\b(YSM Researchers?|View\s+(?:\d+\s+)?(?:Common|Related) Publications?|View (?:Common|Related) Publication|(?:Common|Related) Publications?)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Public DTO for the canonical ResearchEntity API.
 */
export function toPublicResearchEntityDto(group: Record<string, any>): PublicResearchEntityDto {
  const id = stringId(group._id || group.id);
  const kind = group.kind;
  const entityType = group.entityType || mapResearchGroupKindToEntityType(kind);
  const publicGroup = sanitizeResearchEntityPublicDescriptionFields(group);
  const websiteUrl = firstUsableResearchWebsiteUrl([
    publicGroup.websiteUrl,
    publicGroup.website,
    publicGroup.sourceUrls,
  ]);
  if (websiteUrl) {
    publicGroup.websiteUrl = websiteUrl;
  } else {
    delete publicGroup.websiteUrl;
  }
  if (!isUsableResearchWebsiteUrl(publicGroup.website)) {
    delete publicGroup.website;
  }
  const profileResearchAreas = publicResearchAreaArray(publicGroup.profileResearchAreas);

  return {
    ...publicGroup,
    _id: id,
    id,
    slug: publicGroup.slug || '',
    name: publicGroup.name || publicGroup.displayName || '',
    displayName: publicGroup.displayName,
    kind,
    entityKind: kind,
    entityType,
    departments: stringArray(publicGroup.departments),
    researchAreas: publicResearchAreaArray(publicGroup.researchAreas),
    ...(profileResearchAreas.length > 0 ? { profileResearchAreas } : {}),
    sourceUrls: stringArray(publicGroup.sourceUrls).filter(
      (url) => isPubliclyExposableSourceUrl(url) && !isGenericResearchWebsiteIndexUrl(url),
    ),
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
