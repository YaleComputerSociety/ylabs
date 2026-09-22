import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeResearchEntityShortDescription } from '../utils/descriptionHygiene';
import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';
import { filterProseResearchAreaChips } from '../utils/profileResearchTerms';
import { normalizeResearchAreaList } from '../utils/researchAreaHygiene';
import {
  sanitizeMethodChipLabel,
  sanitizeResearchAreaLabel,
} from '../utils/researchAreaLabelHygiene';
import {
  isUngroundedSynthesizedCard,
  resolveServedShortDescription,
} from '../utils/groundedCardSynthesis';
import {
  resolveResearchHomeCardSummary,
  type ResearchHomeCardSummary,
} from '../utils/researchHomeCardSummary';
import { isMultiTenantAcademicHostRootUrl } from '../utils/researchHomeWebsiteUrl';
import { collapseDuplicateResearchHomeSuffix } from '../utils/researchEntityNameNormalization';
import { personScopedResearchEntityNameNamesSomethingElseByUrlPath } from '../utils/researchHomeNameIdentityAuthority';
import { disambiguateCollidingResearchEntityNames } from '../utils/researchEntityDisplayNameDisambiguation';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  MAX_PUBLIC_SOURCE_FIELD_CONTRIBUTIONS,
  SERVED_FIELD_CONTRIBUTION_LABEL_SET,
} from '../utils/servedFieldContributionLabels';

const MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS = 100;
const MAX_PUBLIC_RESEARCH_ENTITY_URLS = 50;
const MAX_PUBLIC_RESEARCH_ENTITY_OBJECT_KEYS = 100;
const MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH = 5000;

export interface PublicResearchEntitySourceFieldContribution {
  sourceUrl: string;
  contributions: string[];
}

export interface PublicResearchEntitySourceLinkHealth {
  url: string;
  healthStatus: string;
  httpStatusCode?: number;
  privateAddressHost?: boolean;
}

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
  methods?: string[];
  sourceUrls: string[];
  sourceLinkHealth?: PublicResearchEntitySourceLinkHealth[];
  cardDescription?: ResearchHomeCardSummary;
}

export interface PublicResearchEntitySummaryDto {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  entityType?: string;
  departments: string[];
  blurb?: string;
}

export function publicResearchEntityId(group: Record<string, any>): string {
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

function publicResearchEntityName(value: unknown): string {
  return collapseDuplicateResearchHomeSuffix(publicTextString(value));
}

const RESEARCH_ENTITY_DESCRIPTION_FIELDS = new Set([
  'fullDescription',
  'profileSynthesisDescription',
]);

const SERVED_COPY_TEXT_FIELDS = [
  'shortDescription',
  'fullDescription',
  'profileSynthesisDescription',
  'summary',
] as const;

const SERVED_COPY_NAME_FIELDS = ['name', 'displayName'] as const;
const SERVED_COPY_ARRAY_FIELDS = ['researchAreas', 'profileResearchAreas'] as const;

/**
 * Run the single canonical serve-time sanitizer over an entity's copy, name, and
 * research-area chip fields so the DTO applies the full guard union (text
 * re-voicing/relabel/fail-close, descriptionHygiene, doubled-suffix name collapse,
 * and research-area chip hygiene) from one place (#1269/#1374). Inputs are bounded
 * to the public caps first so the union never traverses past the DTO's array/text
 * limits on a polluted input; the sanitizer clamps copy to its own sentence/word
 * boundary after.
 *
 * `leadMemberNames` unlocks the one guard in that union that cannot run without
 * them: the mismatched-person-name strip, which repairs copy opening on a
 * possessive person name that is NOT one of this record's own leads. Passing an
 * empty list is not a weaker run of the same guard, it is a structural no-op, so
 * a serve path that omits the names serves a card attributing the record's
 * research to somebody else while the detail page repairs it (#2240).
 */
function servedResearchEntityCopy(
  group: Record<string, any>,
  leadMemberNames: readonly string[] = [],
): Record<string, any> {
  const bounded: Record<string, any> = { ...group };
  for (const field of SERVED_COPY_TEXT_FIELDS) {
    if (typeof bounded[field] === 'string') {
      bounded[field] = bounded[field].slice(0, MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH);
    }
  }
  for (const field of SERVED_COPY_NAME_FIELDS) {
    if (typeof bounded[field] === 'string') {
      bounded[field] = bounded[field].slice(0, MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH);
    }
  }
  for (const field of SERVED_COPY_ARRAY_FIELDS) {
    if (Array.isArray(bounded[field])) {
      bounded[field] = bounded[field].slice(0, MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS);
    }
  }
  return sanitizeServedResearchEntityCopyFields(bounded, leadMemberNames);
}

function publicShortDescriptionString(value: unknown): string {
  const text = String(value || '').slice(0, MAX_PUBLIC_RESEARCH_ENTITY_TEXT_LENGTH);
  return sanitizeResearchEntityShortDescription(text);
}

/**
 * The self-contained card short for a research entity: the sanitized stored
 * shortDescription, or empty when it is a wrong-topic synthesized card that
 * would only be an improvement to discard. A "Studies X" card whose distinctive
 * topic tokens are absent from the entity's own fullDescription can be a
 * wrong-entity graft (#1212), but discarding it is only better when the
 * fallback (the sanitized full, itself already relabeled/hygiene-cleaned by
 * `servedResearchEntityCopy`) is a self-contained summary. When the full opens
 * with a bare-pronoun/CV-bio clause the fallback is strictly worse, so the
 * self-contained short is kept rather than surrendered to it (#1832). When this
 * returns empty, callers fall back via `servedShortDescriptionFallback`, which
 * is itself hygiene-guarded and never a raw bio.
 */
function groundedShortDescriptionString(shortValue: unknown, fullValue: unknown): string {
  const shortDescription = publicShortDescriptionString(shortValue);
  if (!shortDescription) return '';
  if (isUngroundedSynthesizedCard(shortDescription, fullValue)) {
    return publicShortDescriptionString(fullValue) ? '' : shortDescription;
  }
  return shortDescription;
}

/**
 * The guarded fallback served when no self-contained stored short survives
 * (#1832). Rather than serving the raw fullDescription verbatim - which leaked
 * bare-pronoun and CV-bio openers onto the card - derive a fresh self-contained
 * short from the entity's own full via the same canonical resolver the
 * detail-page gate uses (`resolveServedShortDescription`); when nothing derives
 * (a program whose admin copy is not a research summary), serve the full only
 * if it clears the shortDescription hygiene guard, so acceptable admin copy
 * survives while a bare-pronoun/CV opener fails closed to empty. This value is a
 * card derived from the entity's own full, never a stored short, so it is
 * assigned only to the served shortDescription: a restatement comparison must
 * read a stored short, never a short derived from the very full it is judging.
 */
function servedShortDescriptionFallback(served: Record<string, any>, entityType: unknown): string {
  const derived = resolveServedShortDescription({
    shortDescription: '',
    fullDescription: served.fullDescription,
    researchAreas: served.researchAreas,
    entityType,
  });
  return derived || publicShortDescriptionString(served.fullDescription);
}

/**
 * The displayName a person-scoped record may serve, or nothing when the stored
 * value names something else: an umbrella organization the person merely belongs
 * to, or a different person's lab.
 *
 * This is the one name field clients prefer over `name` and the one field no
 * faculty-directory source emits, so a graft on it outlives its own retirement
 * and nothing ever overwrites it (#2351). Withholding it is always safe because
 * `displayName` is only ever a branded alias of `name`, which every caller
 * already falls back to.
 */
function servedPersonScopedDisplayName(group: Record<string, any>, value: unknown): string {
  const displayName = publicResearchEntityName(value);
  if (!displayName) return '';
  return personScopedResearchEntityNameNamesSomethingElseByUrlPath({
    candidateName: displayName,
    entityType: group.entityType,
    kind: group.kind,
    slug: group.slug,
    websiteUrl: group.fieldProvenance?.displayName?.sourceUrl || group.websiteUrl || group.website,
  })
    ? ''
    : displayName;
}

function publicResearchAreaArray(value: unknown): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of normalizeResearchAreaList(stringArray(value))) {
    const cleaned = publicTextString(sanitizeResearchAreaLabel(raw));
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(cleaned);
    if (labels.length >= MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS) break;
  }
  return filterProseResearchAreaChips(labels);
}

function publicMethodsArray(value: unknown, researchAreas: string[]): string[] {
  const excluded = new Set(researchAreas.map((area) => area.toLowerCase()));
  const seen = new Set<string>();
  const methods: string[] = [];
  for (const raw of stringArray(value)) {
    const cleaned = publicTextString(sanitizeMethodChipLabel(raw));
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    methods.push(cleaned);
    if (methods.length >= MAX_PUBLIC_RESEARCH_ENTITY_ARRAY_ITEMS) break;
  }
  return methods;
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

/**
 * The single allowlist for a served source-link-health entry.
 *
 * Exported because the research-detail service had its own byte-identical copy,
 * and `sourceLinkHealth` is an allowlist projection: a field added here silently
 * vanished on the detail route, which is the surface a student actually reads. One
 * owner is what keeps a new axis from reaching the browse payload and not the page
 * (#2556).
 */
export function publicSourceLinkHealthArray(
  value: unknown,
): PublicResearchEntitySourceLinkHealth[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PUBLIC_RESEARCH_ENTITY_URLS).flatMap((entry) => {
    const url = publicHttpUrl((entry as { url?: unknown })?.url);
    const healthStatus = (entry as { healthStatus?: unknown })?.healthStatus;
    if (!url || typeof healthStatus !== 'string') return [];
    const httpStatusCode = (entry as { httpStatusCode?: unknown })?.httpStatusCode;
    const privateAddressHost = (entry as { privateAddressHost?: unknown })?.privateAddressHost;
    return [
      {
        url,
        healthStatus,
        ...(typeof httpStatusCode === 'number' && Number.isFinite(httpStatusCode)
          ? { httpStatusCode }
          : {}),
        ...(privateAddressHost === true ? { privateAddressHost: true } : {}),
      },
    ];
  });
}

/**
 * Re-validated at the DTO boundary rather than trusted from the caller: the label
 * set is closed, so a field name that reached this far without a label is dropped
 * instead of being served as an internal identifier.
 */
function publicSourceFieldContributionsArray(
  value: unknown,
): PublicResearchEntitySourceFieldContribution[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PUBLIC_RESEARCH_ENTITY_URLS).flatMap((entry) => {
    const sourceUrl = publicHttpUrl((entry as { sourceUrl?: unknown })?.sourceUrl);
    const raw = (entry as { contributions?: unknown })?.contributions;
    if (!sourceUrl || !Array.isArray(raw)) return [];
    const contributions = [
      ...new Set(
        raw.filter(
          (label): label is string =>
            typeof label === 'string' && SERVED_FIELD_CONTRIBUTION_LABEL_SET.has(label),
        ),
      ),
    ].slice(0, MAX_PUBLIC_SOURCE_FIELD_CONTRIBUTIONS);
    return contributions.length ? [{ sourceUrl, contributions }] : [];
  });
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

/** Strict card-only DTO used when embedding related entities in a detail response. */
export function toPublicResearchEntitySummaryDto(
  group: Record<string, any>,
): PublicResearchEntitySummaryDto {
  const served = servedResearchEntityCopy(group);
  const summaryEntityType =
    group.entityType === undefined
      ? mapResearchGroupKindToEntityType(group.kind)
      : group.entityType;
  const blurbSource =
    groundedShortDescriptionString(served.shortDescription || '', served.fullDescription) ||
    servedShortDescriptionFallback(served, summaryEntityType);
  const blurb = blurbSource.slice(0, 280);

  return {
    id: publicResearchEntityId(group),
    slug: publicTextString(group.slug || ''),
    name:
      publicResearchEntityName(served.name) ||
      servedPersonScopedDisplayName(group, served.displayName),
    kind: group.kind === undefined ? undefined : publicTextString(group.kind),
    entityType:
      group.entityType === undefined
        ? mapResearchGroupKindToEntityType(group.kind)
        : publicTextString(group.entityType),
    departments: publicDepartmentArray(group.departments),
    ...(blurb ? { blurb } : {}),
  };
}

const OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS = [
  'shortDescription',
  'fullDescription',
  'profileSynthesisDescription',
  'descriptionSource',
  'website',
  'websiteUrl',
  'location',
  'school',
  'schools',
  'currentUndergradCount',
  'undergradEvidenceQuote',
  'pastUndergradAdvisees',
  'offersIndependentStudy',
  'independentStudyCourses',
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
  'typicalUndergradRoles',
  'prerequisiteCourses',
  'creditOptions',
  'fundingPrograms',
  'timeCommitmentHoursPerWeek',
  'lastObservedAt',
  'waysIn',
  'planningContext',
  'profileResearchAreas',
  'researchAreaSource',
] as const;

const OPERATOR_PUBLIC_RESEARCH_ENTITY_FIELDS = ['qualitySummary', 'studentVisibilityTier'] as const;

export interface PublicResearchEntityDtoOptions {
  includeOperatorFields?: boolean;
  forList?: boolean;
  leadMemberNames?: readonly string[];
}

const LIST_TRIMMED_DESCRIPTION_FIELDS = new Set(['fullDescription', 'profileSynthesisDescription']);

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
  const served = servedResearchEntityCopy(group, options.leadMemberNames);
  const groundedShort = groundedShortDescriptionString(
    served.shortDescription,
    served.fullDescription,
  );
  const hostOwnerIdentity = {
    name: served.name ?? group.name,
    displayName: served.displayName ?? group.displayName,
    entityType,
    kind,
  };

  const dto: PublicResearchEntityDto = {
    _id: id,
    id,
    slug: publicTextString(group.slug || ''),
    name:
      publicResearchEntityName(served.name) ||
      servedPersonScopedDisplayName(group, served.displayName),
    displayName:
      group.displayName === undefined
        ? undefined
        : servedPersonScopedDisplayName(group, served.displayName),
    kind,
    entityKind: kind,
    entityType,
    departments: publicDepartmentArray(group.departments),
    researchAreas: publicResearchAreaArray(served.researchAreas),
    sourceUrls: publicHttpUrlArray(group.sourceUrls),
  };

  for (const field of OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS) {
    if (options.forList && LIST_TRIMMED_DESCRIPTION_FIELDS.has(field)) continue;
    if (field === 'shortDescription') {
      if (group.shortDescription !== undefined || group.fullDescription !== undefined) {
        dto.shortDescription = groundedShort || servedShortDescriptionFallback(served, entityType);
      }
      continue;
    }
    if (group[field] !== undefined) {
      if (field === 'website' || field === 'websiteUrl') {
        const url = publicHttpUrl(group[field]);
        if (url && !isMultiTenantAcademicHostRootUrl(url, hostOwnerIdentity)) dto[field] = url;
        continue;
      }
      if (RESEARCH_ENTITY_DESCRIPTION_FIELDS.has(field) && typeof group[field] === 'string') {
        // This used to blank a fullDescription that near-verbatim restates the
        // grounded short. That existed to protect rows the write-time guard had
        // not reached yet (#1721), on the premise that the resolver blanked such
        // a body at materialization anyway. #2721 removed that premise: the
        // materializer now KEEPS a restating body and reconsiders the card
        // instead, so suppressing here discarded the stored body on exactly the
        // rows that had just been re-materialized to hold it, after the
        // visibility gate had admitted them on that body.
        //
        // The detail page then fell back to the card, so what a student read was
        // the lossy line derived from the body rather than the body. The card is
        // derivable from the body and the body is not derivable from the card, so
        // when the two echo each other the body is the half to keep, consistent
        // with the sibling guard in `observationStore`.
        dto[field] = String(served[field] || '');
        continue;
      }
      if (field === 'profileResearchAreas') {
        dto[field] = publicResearchAreaArray(served[field]);
        continue;
      }
      dto[field] = publicTextValue(group[field]);
    }
  }

  if (options.forList) {
    dto.cardDescription = resolveResearchHomeCardSummary({
      shortDescription: served.shortDescription,
      fullDescription: served.fullDescription,
      profileSynthesisDescription: served.profileSynthesisDescription,
      departments: group.departments,
      sourceUrls: group.sourceUrls,
      school: group.school,
    });
  }

  if (group.methods !== undefined) {
    dto.methods = publicMethodsArray(group.methods, dto.researchAreas);
  }

  if (group.sourceLinkHealth !== undefined) {
    dto.sourceLinkHealth = publicSourceLinkHealthArray(group.sourceLinkHealth);
  }

  if (group.sourceFieldContributions !== undefined) {
    dto.sourceFieldContributions = publicSourceFieldContributionsArray(
      group.sourceFieldContributions,
    );
  }

  if (group.leadIdentityStatus === 'verified' || group.leadIdentityStatus === 'under_review') {
    dto.leadIdentityStatus = group.leadIdentityStatus;
  }
  if (typeof group.leadProfessorPublicKey === 'string') {
    const leadProfessorPublicKey = group.leadProfessorPublicKey
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160);
    if (leadProfessorPublicKey) dto.leadProfessorPublicKey = leadProfessorPublicKey;
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

/**
 * Per-hit lead names for a list response, keyed by the same `_id` string every
 * browse/search path already writes onto its hits. Supplied separately from the
 * per-entity options because the list paths resolve the whole page's roster in one
 * batched read; a hit with no entry serves the same card it serves today (#2240).
 */
export interface ResearchEntitySearchAliasOptions extends PublicResearchEntityDtoOptions {
  leadMemberNamesByEntityId?: ReadonlyMap<string, readonly string[]>;
}

export function addResearchEntitySearchAliases<T extends { hits: Record<string, any>[] }>(
  result: T,
  options: ResearchEntitySearchAliasOptions = {},
): Omit<T, 'hits'> & {
  researchEntities: PublicResearchEntityDto[];
} {
  const { leadMemberNamesByEntityId, ...entityOptions } = options;
  const listOptions: PublicResearchEntityDtoOptions = { ...entityOptions, forList: true };
  const researchEntities = disambiguateCollidingResearchEntityNames(
    (result.hits || []).map((hit) =>
      toPublicResearchEntityDto(hit, {
        ...listOptions,
        leadMemberNames: leadMemberNamesByEntityId?.get(String(hit?._id || hit?.id || '')),
      }),
    ),
  );
  const { hits: _hits, ...rest } = result;
  return {
    ...rest,
    researchEntities,
  };
}

export function addResearchEntityDetailAlias<T extends { group: Record<string, any> }>(
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
