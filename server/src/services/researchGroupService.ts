/**
 * Service layer for canonical ResearchEntity browse/detail plus the
 *
 * Strategy for findOrCreateForOwner:
 *   1. Look for an existing group where the owner holds a canonical PI role assignment.
 *   2. If none, derive a slug from the owner (surname + 'lab' or 'individual').
 *   3. Upsert by slug; record the owner's canonical PI role assignment.
 *   4. Return the group _id.
 *
 * The created group is `kind: 'individual'` for fields that don't traditionally have
 * "labs" (Econ, History, etc.); otherwise `kind: 'lab'`. This is determined by the
 * primary department's category.
 */
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers, StudentVisibilityTier } from '../models/studentVisibility';
import { RoleAssignment, roleAssignmentReattachWrite } from '../models/roleAssignment';
import {
  getResearchEntityRoster,
  getResearchEntityRosterByEntityId,
  type ResearchEntityRosterEntry,
} from './researchEntityMembershipAccessor';
import { canonicalRoleForLegacy } from '../models/canonicalRoleMapping';
import { Researcher, type ResearcherProfileLink } from '../models/researcher';
import { Department, DepartmentCategory } from '../models/department';
import { resolveOrCreateResearcherIdForIdentity } from '../scrapers/canonicalMembershipMaterializer';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { Signal } from '../models/signal';
import { getMeiliIndex } from '../utils/meiliClient';
import {
  isResearchEntitySearchEmbedderConfigured,
  RESEARCH_ENTITY_SEARCH_EMBEDDER_NAME,
  RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
} from './researchEntitySearchIndexService';
import { embedSearchQuery } from './searchQueryEmbedding';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { isDisallowedResearchEntitySourceUrl } from '../utils/researchHomeWebsiteUrl';
import { buildSourceFieldContributions } from '../utils/servedFieldContributionLabels';
import {
  detectProfileIdentityRisk,
  entityOfficialPersonProfileDestinations,
  hasSpecificOfficialPersonPathSegment,
  normalizeOfficialProfileDestination,
  resolveLeadOfficialProfileUrl,
} from './leadProfileIdentity';
import { buildResearchGroupFilterString, ResearchGroupFilterInput } from './researchGroupFilters';
import {
  buildResearchEntityQualitySummary,
  type ResearchEntityQualitySummary,
} from './researchEntityQuality';
import { accessSignalTypes, mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  publicSourceLinkHealthArray,
  toPublicResearchEntitySummaryDto,
  type PublicResearchEntityDto,
  type PublicResearchEntitySummaryDto,
} from './researchEntityDto';
import {
  isLikelyPublicProfileImageUrl,
  isSharedProfileImageAcrossDifferentNames,
} from '../scripts/profileImageQualityAuditCore';
import { sanitizeResearchEntityPublicDescriptionFields } from '../utils/researchEntityDescriptionText';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  researchEntityServesPublicDetail,
  withPublicDescriptionGateFields,
} from './researchEntityPublicDescription';
import { resolveResearchEntityCanonicalIdentity } from './researchEntityCanonicalTombstone';
import {
  researchEntityHasDeceasedLead,
  stripTrailingPersonNameLifespan,
} from '../utils/researchEntityDeceasedLead';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { sanitizePersonTitle } from '../utils/titleHygiene';
import {
  personNameHasLifespanSuffix,
  stripPersonNameLifespanSuffix,
} from '../utils/personNameLifespan';
import { sanitizePersonName } from '../utils/personNameHygiene';
import { sanitizeResearchAreaFacetDistribution } from '../utils/researchAreaLabelHygiene';
import { isServableOfficialProfileLink } from '../utils/officialProfileLinkServability';
import { listPlanningContextsForResearchEntities } from './planningContextService';
import {
  listDepartmentCourseCreditRoutes,
  type PublicDepartmentCourseCreditRoute,
} from './departmentResearchContextService';
import {
  QUERY_TOPIC_ALIASES,
  STUDENT_QUERY_ALIASES,
  WORKING_STYLE_PHRASE_ALIASES,
  WORKING_STYLE_PHRASE_MAX_TOKENS,
} from './searchTopicAliases';
import { maxReachableResearchSearchPage } from './researchSearchPagination';

/**
 * The page's lead display names, batched for the whole hit set in one roster read
 * the way `optionalPlanningContexts` batches its own enrichment.
 *
 * The browse/search DTO cannot run the mismatched-person-name guard without these,
 * so a card opening on a possessive name that is not one of the record's own leads
 * reached students unrepaired while the detail page repaired it (#2240). Degrades
 * to no names rather than failing the request: a list response with today's cards
 * is strictly better than no list at all, and the detail page remains the stricter
 * surface either way.
 *
 * Takes whole entity documents, not ids, because the derivation the detail page runs
 * reads `rosterEnrichment` off the row to decide whether an official-roster row is
 * still fresh. Deriving names from a looser filter here would feed the sanitizer a
 * different lead set per surface and reopen the very divergence being closed.
 *
 * The roster read is scoped to the people who hold a lead role somewhere on the page,
 * and keeps ALL of those people's rows on those entities. That is not a looser filter:
 * `collapseRosterEntriesByPerson` resolves one row per person, so a person holding no
 * lead row anywhere cannot resolve to a lead, while a person who does needs every row
 * they hold for the collapse to pick the same one the detail page picks.
 */
export const optionalPublicLeadMemberNames = async (
  entities: Array<Record<string, any>>,
): Promise<Map<string, readonly string[]>> => {
  const byEntityId = new Map<string, readonly string[]>();
  try {
    const rosterByEntityId = await getResearchEntityRosterByEntityId(
      entities.map((entity) => entity._id),
      { peopleHoldingCanonicalRoles: PUBLIC_LEAD_CANONICAL_ROLES },
    );
    const now = new Date();
    for (const entity of entities) {
      const entityId = researchGroupDocumentId(entity._id);
      const entries = rosterByEntityId.get(entityId);
      if (!entityId || !entries?.length) continue;
      const leadNames = publicResearchEntityLeadMemberNames(entity, entries, now);
      if (leadNames.length > 0) byEntityId.set(entityId, leadNames);
    }
  } catch (error) {
    console.error('Optional research lead-name enrichment failed:', sanitizeLogValue(error));
  }
  return byEntityId;
};

const optionalPlanningContexts = async (entityIds: any[]) => {
  try {
    return {
      contexts: await listPlanningContextsForResearchEntities(entityIds),
      degraded: false,
    };
  } catch (error) {
    console.error('Optional research planning-context enrichment failed:', sanitizeLogValue(error));
    return {
      contexts: new Map(),
      degraded: true,
    };
  }
};

const optionalDepartmentCourseCreditRoutes = async (
  departmentNames: string[],
): Promise<PublicDepartmentCourseCreditRoute[]> => {
  try {
    return await listDepartmentCourseCreditRoutes(departmentNames);
  } catch (error) {
    console.error('Optional department course-credit enrichment failed:', sanitizeLogValue(error));
    return [];
  }
};

const NON_LAB_CATEGORIES = new Set<string>([
  DepartmentCategory.SOCIAL_SCIENCES,
  DepartmentCategory.HUMANITIES_ARTS,
  DepartmentCategory.ECONOMICS,
]);
const RESEARCH_GROUP_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const researchGroupDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

export interface OwnerLike {
  _id?: any;
  netid?: string;
  fname?: string;
  lname?: string;
  primaryDepartment?: string;
}

export const normalizeResearchGroupObjectId = (value: unknown): string | undefined => {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value instanceof mongoose.Types.ObjectId
        ? value.toHexString()
        : '';
  return RESEARCH_GROUP_OBJECT_ID_RE.test(id) ? id : undefined;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['']s\b/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function inferKindFromDepartment(deptName?: string): Promise<'lab' | 'individual'> {
  if (!deptName) return 'lab';
  const dept = await Department.findOne({
    $or: [{ name: deptName }, { displayName: deptName }, { aliases: deptName }],
  }).lean();
  if (!dept) return 'lab';
  const cat = (dept as any).primaryCategory as string | undefined;
  if (cat && NON_LAB_CATEGORIES.has(cat)) return 'individual';
  return 'lab';
}

function ownerSlugSeed(owner: OwnerLike, kind: 'lab' | 'individual'): string {
  const surname = (owner.lname || '').trim();
  const netid = (owner.netid || '').trim().toLowerCase();
  if (kind === 'individual') {
    if (surname) return `${slugify(surname)}-${netid || 'profile'}`;
    return `${netid || 'profile'}-research`;
  }
  if (surname) return `${slugify(surname)}-lab-${netid || ''}`.replace(/-+$/, '');
  return `${netid || 'unknown'}-lab`;
}

function ownerDisplayName(owner: OwnerLike, kind: 'lab' | 'individual'): string {
  const surname = (owner.lname || '').trim();
  const fname = (owner.fname || '').trim();
  if (kind === 'individual') {
    if (fname && surname) return `${fname} ${surname} - Research`;
    if (surname) return `${surname} Research`;
    return owner.netid ? `${owner.netid} Research` : 'Research';
  }
  if (surname) return `${surname} Lab`;
  return owner.netid ? `${owner.netid} Lab` : 'Lab';
}

/**
 * Returns an existing ResearchEntity for which the owner is the PI, or creates a stub one.
 * Never throws on duplicate slug — uses upsert + member-row idempotent insert.
 */
export async function findOrCreateForOwner(owner: OwnerLike): Promise<{
  group: any;
  created: boolean;
}> {
  if (!owner._id && !owner.netid) {
    throw new Error('findOrCreateForOwner requires owner._id or owner.netid');
  }

  const ownerDisplayNameValue =
    [owner.fname, owner.lname].filter(Boolean).join(' ').trim() || undefined;
  const ownerPersonId = await resolveOrCreateResearcherIdForIdentity({
    netid: owner.netid,
    displayName: ownerDisplayNameValue,
    hasCanonicalSourceReference: true,
  });
  if (ownerPersonId) {
    const existingLeadAssignment = await RoleAssignment.findOne({
      personId: ownerPersonId,
      'target.kind': 'RESEARCH_ENTITY',
      role: 'PI',
    })
      .select('target')
      .lean();
    const existingResearchEntityId = normalizeResearchGroupObjectId(
      (existingLeadAssignment as any)?.target?.id,
    );
    if (existingResearchEntityId) {
      const group = await ResearchEntity.findById(existingResearchEntityId).lean();
      if (group) return { group, created: false };
    }
  }

  const kind = await inferKindFromDepartment(owner.primaryDepartment);
  const slug = ownerSlugSeed(owner, kind);
  const name = ownerDisplayName(owner, kind);

  const update: any = {
    $setOnInsert: {
      slug,
      name,
      kind,
      entityType: mapResearchGroupKindToEntityType(kind),
      lastObservedAt: new Date(),
      sourceUrls: [],
      departments: owner.primaryDepartment ? [owner.primaryDepartment] : [],
    },
  };

  let group: any;
  await mongoose.connection.transaction(async (session) => {
    group = await ResearchEntity.findOneAndUpdate({ slug }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session,
    }).lean();
  });
  if (ownerPersonId) {
    const now = new Date();
    const roleFilter = {
      personId: ownerPersonId,
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': group._id,
      role: 'PI',
    };
    await RoleAssignment.updateOne(
      roleFilter,
      {
        $set: {
          personId: ownerPersonId,
          target: { kind: 'RESEARCH_ENTITY', id: group._id },
          role: 'PI',
          state: 'CURRENT',
          confidence: 1,
        },
        $setOnInsert: { startedAt: now, archived: false, reviewStatus: 'UNREVIEWED' },
        $unset: { endedAt: '' },
      },
      { upsert: true },
    );
    const reattach = roleAssignmentReattachWrite(roleFilter, 'UNREVIEWED');
    await RoleAssignment.updateOne(reattach.filter, reattach.update);
  }

  const created = !group.updatedAt || group.createdAt?.getTime?.() === group.updatedAt?.getTime?.();
  return { group, created };
}

export interface ResearchGroupSearchSort {
  sortBy?: 'lastObservedAt' | 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export type ResearchGroupQualityFilter = 'description-issue' | 'missing-lead' | 'profile-fallback';

export interface ResearchGroupSearchOptions {
  includeNonPublic?: boolean;
  lowQualityFirst?: boolean;
  qualityFilters?: ResearchGroupQualityFilter[];
  // Facets describe the whole result set rather than the page, and computing
  // them costs an exhaustive count plus one disjunctive query per active filter.
  // A caller that already holds them can opt out. Defaults to true.
  includeFacets?: boolean;
}

export interface ResearchGroupSearchResult {
  researchEntities: PublicResearchEntityDto[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
  facetDistribution?: Record<string, Record<string, number>>;
  degraded?: boolean;
}

const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_FILTER_VALUES = 50;
// Hybrid k-NN search always returns the `limit` nearest vectors regardless of how
// dissimilar they are, so a text query with no real match otherwise dumps the whole
// student-visible corpus. Genuine matches score >= ~0.2 (exact name ~0.72, broad
// topics 0.2-0.99) while pure-noise queries score ~1e-7, so this cutoff drops noise
// without clipping legitimate weak-but-real matches. See #823.
const HYBRID_RANKING_SCORE_THRESHOLD = 0.15;
// At semanticRatio 0.8 a hybrid hit's blended score is 0.8*similarity for a
// semantic-only hit but only 0.2*keywordScore for a keyword-only hit, so a weak
// semantic-only hit (e.g. a same-first-name person at similarity ~0.27) can
// outrank a near-perfect keyword/exact-name match (blended ~0.198). Any
// semantic-only hit below this similarity is treated as too weak to sit above a
// real keyword match and is floored beneath the keyword hits. Genuine broad
// topical matches score well above this, so pure-semantic ranking is untouched.
// See #929.
const WEAK_SEMANTIC_ONLY_SIMILARITY_FLOOR = 0.5;
// Meilisearch hybrid fusion re-ranks the whole candidate set as the requested
// page size grows: a larger `hitsPerPage` pulls more semantic neighbors into the
// fused/scored pool, which shifts the relative order of results that already
// cleared `rankingScoreThreshold`, so the #1 result becomes a function of the
// requested page size. To make ordering deterministic, every thresholded hybrid
// query fetches a fixed candidate pool of this size (independent of the requested
// page size) and paginates locally against the already-stable ordering. See #1064.
export const HYBRID_CANDIDATE_POOL_SIZE = 200;
const MAX_FILTER_VALUE_LENGTH = 120;
const STUDENT_QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'from',
  'for',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'prof',
  'professor',
  'professors',
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'research',
  'researcher',
  'researchers',
  'where',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'why',
  'how',
  'can',
  'could',
  'would',
  'should',
  'do',
  'does',
  'did',
  'is',
  'are',
  'am',
  'be',
  'been',
  'being',
  'i',
  'me',
  'my',
  'we',
  'us',
  'our',
  'you',
  'your',
  'study',
  'studying',
  'studied',
  'using',
  'use',
  'used',
  'find',
  'finding',
  'looking',
  'look',
  'want',
  'wanting',
  'interested',
  'join',
  'joining',
  'about',
  'that',
  'there',
  'best',
  'some',
  'any',
  // Question-frame verbs only. `studies`, `work`, and `working` are deliberately
  // absent: the corpus carries them as real field names (192 researchAreas and 11
  // departments contain "studies", including African Studies and Film & Media
  // Studies; "Sex Work"; "Working Memory"), so stripping them would silently
  // narrow those queries to their remaining tokens.
  'doing',
  'works',
  'take',
  'takes',
]);

// `work` and `working` name real fields on their own ("Sex Work", "Working
// Memory"), so they are filler only where they govern a preposition, which no
// indexed field name does.
const QUESTION_FRAME_VERBS_BEFORE_PREPOSITION = new Set(['work', 'working']);
const QUESTION_FRAME_VERB_PREPOSITIONS = new Set(['on', 'with']);

// `lab` is filler as a bare head noun, because every entity in the corpus is one,
// but it is load-bearing where it completes a governed working-style phrase: the
// qualifier in "wet lab" means nothing without the noun it modifies, and the
// stripped text is also the embedder's input, so dropping the noun leaves a phrase
// with no research meaning. Measured on Development, "wet experience beginner"
// tops out at a 0.093 ranking score, below HYBRID_RANKING_SCORE_THRESHOLD, so the
// whole query returned nothing; keeping the noun reaches 0.267. See #2715.
const completesWorkingStylePhrase = (tokens: string[], index: number): boolean => {
  for (let length = 2; length <= WORKING_STYLE_PHRASE_MAX_TOKENS; length += 1) {
    const start = index - length + 1;
    if (start < 0) continue;
    if (WORKING_STYLE_PHRASE_ALIASES[tokens.slice(start, index + 1).join(' ')]) return true;
  }
  return false;
};

const isStudentQueryFiller = (tokens: string[], index: number): boolean => {
  const token = tokens[index];
  if (completesWorkingStylePhrase(tokens, index)) return false;
  if (STUDENT_QUERY_STOP_WORDS.has(token)) return true;
  return (
    QUESTION_FRAME_VERBS_BEFORE_PREPOSITION.has(token) &&
    QUESTION_FRAME_VERB_PREPOSITIONS.has(tokens[index + 1] ?? '')
  );
};

// A student's working-style words are not the corpus's, so the phrase is replaced
// by the vocabulary the corpus carries. That also makes the query an OR expansion
// rather than a literal phrase, which keeps `matchingStrategy` permissive: the
// keyword leg can then reach rows carrying any one of the canonical terms, and
// #2732's ordering serves those ahead of the weak semantic neighbours that are all
// a phrase nothing carries can otherwise retrieve. See #2715.
const expandWorkingStylePhrases = (
  tokens: string[],
): { terms: string[]; expandedAPhrase: boolean } => {
  const terms: string[] = [];
  let expandedAPhrase = false;
  let index = 0;
  while (index < tokens.length) {
    let matchedLength = 0;
    for (let length = WORKING_STYLE_PHRASE_MAX_TOKENS; length >= 2; length -= 1) {
      const canonical = WORKING_STYLE_PHRASE_ALIASES[tokens.slice(index, index + length).join(' ')];
      if (canonical) {
        terms.push(...canonical);
        matchedLength = length;
        expandedAPhrase = true;
        break;
      }
    }
    if (matchedLength === 0) terms.push(tokens[index]);
    index += matchedLength || 1;
  }
  return { terms, expandedAPhrase };
};

const resolveTopicAliasExpansion = (queryTokens: string[]): string[] | null => {
  if (queryTokens.length === 0) return null;
  return QUERY_TOPIC_ALIASES[queryTokens.join(' ')] ?? null;
};

const TOPIC_ALIAS_QUERY_ATTRIBUTES = ['studentSearchTerms', 'researchAreas', 'departments'];

const boundedResearchSearchQuery = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
};

const tokenizeStudentResearchQuery = (query: string): string[] =>
  query
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

const uniqueQueryTerms = (terms: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
};

export interface NormalizedResearchSearchQuery {
  raw: string;
  query: string;
  tokens: string[];
  isTopicAliasQuery: boolean;
  isAliasExpanded: boolean;
  aliasExpansionKeepsShorthand: boolean;
  aliasExpandsToSingleCanonicalPhrase: boolean;
  aliasTerms: string[] | null;
}

export const normalizeResearchSearchQuery = (value: unknown): NormalizedResearchSearchQuery => {
  const raw = boundedResearchSearchQuery(value);
  const tokens = tokenizeStudentResearchQuery(raw);
  const meaningfulTokens = tokens.filter((_token, index) => !isStudentQueryFiller(tokens, index));
  const queryTokens = meaningfulTokens.length > 0 ? meaningfulTokens : tokens;
  const aliasExpansion = resolveTopicAliasExpansion(queryTokens);
  const workingStyle = expandWorkingStylePhrases(queryTokens);
  const hasPerTokenAliasExpansion = workingStyle.terms.some(
    (token) => STUDENT_QUERY_ALIASES[token] !== undefined,
  );
  const expandedTerms = aliasExpansion
    ? aliasExpansion
    : workingStyle.terms.flatMap((token) => STUDENT_QUERY_ALIASES[token] || [token]);
  const normalizedTerms = uniqueQueryTerms(expandedTerms);
  const typedShorthand = queryTokens.join(' ');
  const keepsShorthand =
    aliasExpansion !== null &&
    normalizedTerms.some((term) => term.toLowerCase() === typedShorthand);

  return {
    raw,
    query: normalizedTerms.join(' ').slice(0, MAX_SEARCH_QUERY_LENGTH),
    tokens: queryTokens,
    isTopicAliasQuery: aliasExpansion !== null,
    isAliasExpanded:
      aliasExpansion !== null || hasPerTokenAliasExpansion || workingStyle.expandedAPhrase,
    aliasExpansionKeepsShorthand: keepsShorthand,
    aliasExpandsToSingleCanonicalPhrase:
      aliasExpansion !== null && !keepsShorthand && normalizedTerms.length === 1,
    aliasTerms: aliasExpansion ? normalizedTerms : null,
  };
};

const boundedResearchFilterValues = (values?: string[]): string[] => {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const boundedValue = value.trim().slice(0, MAX_FILTER_VALUE_LENGTH);
    if (!boundedValue || seen.has(boundedValue)) continue;
    seen.add(boundedValue);
    clean.push(boundedValue);
    if (clean.length >= MAX_FILTER_VALUES) break;
  }

  return clean;
};

const isResearchGroupQualityFilter = (value: unknown): value is ResearchGroupQualityFilter =>
  value === 'description-issue' || value === 'missing-lead' || value === 'profile-fallback';

const sanitizeResearchGroupSearchFilters = (
  filters: ResearchGroupFilterInput = {},
): ResearchGroupFilterInput => ({
  kind: boundedResearchFilterValues(filters.kind),
  entityType: boundedResearchFilterValues(filters.entityType),
  school: boundedResearchFilterValues(filters.school),
  departments: boundedResearchFilterValues(filters.departments),
  researchAreas: boundedResearchFilterValues(filters.researchAreas),
  hostsUndergrads: filters.hostsUndergrads === true ? true : undefined,
  studentVisibilityTier: boundedResearchFilterValues(filters.studentVisibilityTier),
});

const sanitizeResearchGroupSearchOptions = (
  options: ResearchGroupSearchOptions = {},
): ResearchGroupSearchOptions => {
  return {
    includeNonPublic: options.includeNonPublic === true,
    lowQualityFirst: options.lowQualityFirst === true,
    qualityFilters: boundedResearchFilterValues(
      options.qualityFilters as string[] | undefined,
    ).filter(isResearchGroupQualityFilter),
    includeFacets: options.includeFacets !== false,
  };
};

const mongoVisibilityFilter = (
  filters: ResearchGroupFilterInput,
  includeNonPublic?: boolean,
): Record<string, any> => {
  if (filters.studentVisibilityTier?.length) {
    return { studentVisibilityTier: { $in: filters.studentVisibilityTier } };
  }
  return includeNonPublic ? {} : { studentVisibilityTier: { $in: publicStudentVisibilityTiers } };
};

const isPublicVisibilityScope = (
  filters: ResearchGroupFilterInput,
  includeNonPublic?: boolean,
): boolean => !includeNonPublic && !filters.studentVisibilityTier?.length;

const servesPublicResearchDetail = researchEntityServesPublicDetail;

const withServablePublicResearchEntities = <T extends Record<string, any>>(
  entities: T[],
  filters: ResearchGroupFilterInput,
  includeNonPublic?: boolean,
): T[] =>
  isPublicVisibilityScope(filters, includeNonPublic)
    ? entities.filter(servesPublicResearchDetail)
    : entities;

const applyVisibilityScopeToFilters = (
  filters: ResearchGroupFilterInput,
  includeNonPublic?: boolean,
): ResearchGroupFilterInput => {
  if (includeNonPublic || filters.studentVisibilityTier?.length) {
    return filters;
  }
  return { ...filters, studentVisibilityTier: [...publicStudentVisibilityTiers] };
};

const mongoFilterFromResearchFilters = (
  filters: ResearchGroupFilterInput,
  includeNonPublic?: boolean,
): Record<string, any> => {
  const mongoFilter: Record<string, any> = {
    archived: { $ne: true },
    ...mongoVisibilityFilter(filters, includeNonPublic),
  };

  if (filters.kind?.length) mongoFilter.kind = { $in: filters.kind };
  if (filters.entityType?.length) mongoFilter.entityType = { $in: filters.entityType };
  if (filters.school?.length) mongoFilter.schools = { $in: filters.school };
  if (filters.departments?.length) mongoFilter.departments = { $in: filters.departments };
  if (filters.researchAreas?.length) mongoFilter.researchAreas = { $in: filters.researchAreas };
  if (filters.hostsUndergrads === true) {
    mongoFilter.hasUndergradHostingEvidence = true;
  }

  return mongoFilter;
};

const LEAD_MEMBER_ROLES = new Set(['pi', 'principal_investigator', 'lead', 'faculty_lead']);

const leadMembersForEntities = async (entityIds: any[]): Promise<Map<string, any[]>> => {
  if (entityIds.length === 0) return new Map();
  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);
  const byEntityId = new Map<string, any[]>();
  for (const [key, roster] of rosterByEntityId) {
    const leads = roster.filter((member) => LEAD_MEMBER_ROLES.has(member.role));
    if (leads.length > 0) byEntityId.set(key, leads);
  }
  return byEntityId;
};

const withQualitySummaries = async (
  entities: any[],
): Promise<Array<any & { qualitySummary: ResearchEntityQualitySummary }>> => {
  const leadMembersByEntityId = await leadMembersForEntities(entities.map((entity) => entity._id));
  return entities.map((entity) => ({
    ...entity,
    qualitySummary: buildResearchEntityQualitySummary({
      entity,
      leadMembers: leadMembersByEntityId.get(researchGroupDocumentId(entity._id)) || [],
    }),
  }));
};

const matchesQualityFilters = (
  qualitySummary: ResearchEntityQualitySummary,
  qualityFilters: ResearchGroupQualityFilter[] = [],
): boolean => {
  if (qualityFilters.length === 0) return true;
  return qualityFilters.every((filter) => {
    if (filter === 'description-issue') {
      return (
        qualitySummary.repairFlags.includes('missing_description') ||
        qualitySummary.repairFlags.includes('thin_description') ||
        qualitySummary.repairFlags.includes('missing_card_description')
      );
    }
    if (filter === 'missing-lead') {
      return qualitySummary.repairFlags.includes('missing_lead');
    }
    return qualitySummary.repairFlags.includes('profile_fallback_only');
  });
};

const isMissingMeiliEmbedderError = (error: unknown): boolean => {
  const maybeError = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  return (
    maybeError?.code === 'invalid_search_embedder' ||
    maybeError?.cause?.code === 'invalid_search_embedder' ||
    /Cannot find embedder/i.test(maybeError?.message || '') ||
    /Cannot find embedder/i.test(maybeError?.cause?.message || '')
  );
};

/**
 * True when Meilisearch rejected the query because a requested sort attribute is
 * not in the index's sortableAttributes. Lets the default browse degrade
 * gracefully when a newly-added sortable attribute (e.g. browseRankScore) has
 * not yet been pushed to the running index's settings.
 */
const isUnsortableAttributeError = (error: unknown): boolean => {
  const maybeError = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = maybeError?.code || maybeError?.cause?.code;
  const message = maybeError?.message || maybeError?.cause?.message || '';

  return (
    code === 'invalid_search_sort' ||
    code === 'invalid_sort' ||
    /not sortable|sortable attributes/i.test(message)
  );
};

/**
 * True when the running Meilisearch is too old to understand the
 * `rankingScoreThreshold` search parameter (added in Meili v1.5). Lets the query
 * recover by dropping the threshold instead of failing all the way back to Mongo.
 */
const isUnsupportedRankingScoreThresholdError = (error: unknown): boolean => {
  const maybeError = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const message = maybeError?.message || maybeError?.cause?.message || '';

  return /rankingScoreThreshold/i.test(message);
};

/**
 * When Meilisearch rejects a query because `attributesToSearchOn` references an
 * attribute missing from the running index's searchableAttributes (config
 * drift), let the query recover by dropping the restriction and searching all
 * attributes rather than falling all the way back to the slow Mongo path.
 */
const isInvalidSearchAttributesToSearchOnError = (error: unknown): boolean => {
  const maybeError = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = maybeError?.code || maybeError?.cause?.code;
  const message = maybeError?.message || maybeError?.cause?.message || '';

  return (
    code === 'invalid_search_attributes_to_search_on' ||
    /is not searchable|attributes to search on/i.test(message)
  );
};

const KEYWORD_RANKING_RULE_KEYS = ['words', 'typo', 'proximity', 'attribute', 'exactness'];

/**
 * True when Meilisearch retrieved this hit via the keyword leg of a hybrid
 * search, i.e. `_rankingScoreDetails` carries at least one keyword ranking rule.
 * A purely semantic hit only carries a `vectorSort` detail.
 */
const hitMatchedKeywordLeg = (hit: any): boolean => {
  const details = hit?._rankingScoreDetails;
  if (!details || typeof details !== 'object') return false;
  return KEYWORD_RANKING_RULE_KEYS.some((key) => key in details);
};

/**
 * True when the hit was retrieved only by the semantic leg with a similarity
 * below the weak-match floor, so it should not sit above real keyword matches.
 */
const hitIsWeakSemanticOnly = (hit: any): boolean => {
  const details = hit?._rankingScoreDetails;
  if (!details || typeof details !== 'object') return false;
  const similarity = details.vectorSort?.similarity;
  if (typeof similarity !== 'number') return false;
  if (hitMatchedKeywordLeg(hit)) return false;
  return similarity < WEAK_SEMANTIC_ONLY_SIMILARITY_FLOOR;
};

/**
 * Stable re-rank that floors weak semantic-only hits beneath every hit that
 * matched the keyword leg (or matched semantics strongly). Only engages when the
 * result set actually contains a keyword match to protect, so pure-semantic
 * topical queries keep Meilisearch's native hybrid ordering untouched. Fixes the
 * name-query mis-ordering in #929 without changing `semanticRatio`.
 */
export const floorWeakSemanticOnlyHits = <T>(hits: T[]): T[] => {
  if (!Array.isArray(hits) || hits.length < 2) return hits;
  if (!hits.some(hitMatchedKeywordLeg)) return hits;
  const strong: T[] = [];
  const weak: T[] = [];
  for (const hit of hits) {
    if (hitIsWeakSemanticOnly(hit)) weak.push(hit);
    else strong.push(hit);
  }
  if (weak.length === 0 || strong.length === 0) return hits;
  return [...strong, ...weak];
};

/**
 * Orders the candidate set by the keyword leg's own ranking, then appends the
 * hybrid pool rows the keyword leg did not return, deduplicating on either id
 * field.
 *
 * Merging the other way round (pool order first, keyword-leg rows appended) is
 * what this did before and it re-imported the very defect the separate keyword
 * leg exists to avoid: the pool is ordered by the blended score, so the keyword
 * matches inside it were still ranked by an embedding similarity that a typo
 * moves wholesale, and a keyword row the pool did not hold sat behind every
 * pooled row whatever its keyword relevance. The keyword leg is queried
 * precisely because the blended score cannot represent it, so the blended score
 * must not order its rows either.
 *
 * This is a narrow change to the keyword/semantic split rather than a rewrite of
 * it: `floorWeakSemanticOnlyHits` (#929) already floors a semantic-only hit
 * beneath every keyword match unless its similarity clears
 * WEAK_SEMANTIC_ONLY_SIMILARITY_FLOOR, and measured over the harness queries
 * against Development only 117 of 13,806 pooled rows (0.85%) were semantic-only
 * above that floor. The pool keeps every row it held, so paging still reaches
 * all of them. See #2732.
 */
export const orderCandidatesByKeywordLeg = <T>(poolHits: T[], keywordLegHits: T[]): T[] => {
  const pool = Array.isArray(poolHits) ? poolHits : [];
  if (!Array.isArray(keywordLegHits) || keywordLegHits.length === 0) return pool;
  const hitId = (hit: any): string => String(hit?.id ?? hit?._id);
  const keywordLegIds = new Set(keywordLegHits.map(hitId));
  return [...keywordLegHits, ...pool.filter((hit) => !keywordLegIds.has(hitId(hit)))];
};

/**
 * True when the hit's keyword-leg relevance rests entirely on a coincidental
 * typo: only some query words matched, none of them exactly, and the partial
 * match was only reachable by tolerating a typo. This is the narrow-crossing
 * garbage match that a single blended `rankingScoreThreshold` cannot separate
 * from a genuine weak-but-real hit, so for a real zero-coverage query it leaks
 * through as the lone, confident-looking result. Purely semantic hits carry no
 * keyword ranking rules, so they never trip this. See #1015.
 */
const hitIsCoincidentalTypoOnlyMatch = (hit: any): boolean => {
  if (!hitMatchedKeywordLeg(hit)) return false;
  const details = hit?._rankingScoreDetails;
  const words = details?.words;
  const exactness = details?.exactness;
  const typo = details?.typo;
  if (!words || !exactness || !typo) return false;
  const partialWordCoverage =
    typeof words.matchingWords === 'number' &&
    typeof words.maxMatchingWords === 'number' &&
    words.matchingWords < words.maxMatchingWords;
  const noExactMatch = exactness.matchType === 'noExactMatch';
  const reliedOnTypo = typeof typo.typoCount === 'number' && typo.typoCount > 0;
  return partialWordCoverage && noExactMatch && reliedOnTypo;
};

/**
 * Drops keyword-leg hits whose entire match is a coincidental partial typo (see
 * `hitIsCoincidentalTypoOnlyMatch`) and reports how many were removed so the
 * caller can keep the total-hits count honest. Requires full word coverage or an
 * exact match before a keyword hit counts, rather than trusting the blended
 * score cutoff alone. See #1015.
 */
export const dropCoincidentalTypoOnlyHits = <T>(hits: T[]): { hits: T[]; dropped: number } => {
  if (!Array.isArray(hits) || hits.length === 0) return { hits, dropped: 0 };
  const kept = hits.filter((hit) => !hitIsCoincidentalTypoOnlyMatch(hit));
  return { hits: kept, dropped: hits.length - kept.length };
};

const normalizeExactMatchValue = (value: string): string =>
  value
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hitStringFieldValues = (hit: any, field: string): string[] =>
  Array.isArray(hit?.[field])
    ? hit[field].filter((value: unknown): value is string => typeof value === 'string')
    : [];

const hitHasExactAliasValue = (hit: any, field: string, aliasTermSet: Set<string>): boolean =>
  hitStringFieldValues(hit, field).some((value) =>
    aliasTermSet.has(normalizeExactMatchValue(value)),
  );

/**
 * Alias-expanded queries (`STUDENT_QUERY_ALIASES`, e.g. `psych`/`neuro`) hand
 * Meilisearch a multi-term OR query whose default ranking rewards fuzzy
 * multi-term coverage before exactness, so an entity that fuzzily matches a
 * couple of loosely-related expansion terms can outrank one whose own
 * `departments`/`researchAreas` field is an exact match for the aliased-from
 * topic. This stable re-rank promotes exact `departments` matches, then exact
 * `researchAreas` matches, above the fuzzy remainder while preserving
 * Meilisearch's order within each tier. Engages only when at least one exact
 * match exists, so ordinary alias result sets keep native ordering. #983.
 */
export const promoteExactAliasFieldMatches = <T>(hits: T[], aliasTerms: string[] | null): T[] => {
  if (!Array.isArray(hits) || hits.length < 2 || !aliasTerms || aliasTerms.length === 0) {
    return hits;
  }
  const aliasTermSet = new Set(aliasTerms.map(normalizeExactMatchValue));
  const exactDepartment: T[] = [];
  const exactResearchArea: T[] = [];
  const rest: T[] = [];
  for (const hit of hits) {
    if (hitHasExactAliasValue(hit, 'departments', aliasTermSet)) exactDepartment.push(hit);
    else if (hitHasExactAliasValue(hit, 'researchAreas', aliasTermSet)) exactResearchArea.push(hit);
    else rest.push(hit);
  }
  if (exactDepartment.length === 0 && exactResearchArea.length === 0) return hits;
  return [...exactDepartment, ...exactResearchArea, ...rest];
};

// Facets a student can actively filter on. Each must be computed
// disjunctively: excluding only its own active filter clause so its option
// list keeps every sibling value (with counts under the other active filters)
// and stays switchable, instead of self-collapsing to the single chosen value.
// Cross-facet narrowing is preserved because only the facet's own clause is
// dropped; every other active filter still constrains the distribution. See
// issue #1080.
const DISJUNCTIVE_RESEARCH_FACETS: ReadonlyArray<{
  filterKey: 'school' | 'departments' | 'researchAreas' | 'entityType';
  meiliField: 'schools' | 'departments' | 'researchAreas' | 'entityType';
}> = [
  { filterKey: 'school', meiliField: 'schools' },
  { filterKey: 'departments', meiliField: 'departments' },
  { filterKey: 'researchAreas', meiliField: 'researchAreas' },
  { filterKey: 'entityType', meiliField: 'entityType' },
];

const RESEARCH_ENTITY_SEARCH_FACET_FIELDS = [
  'schools',
  'departments',
  'researchAreas',
  'entityType',
];

/**
 * Meilisearch query for ResearchEntity: keyword-only when no query, hybrid
 * (semanticRatio 0.8) for a non-empty query only when the `default` embedder
 * is actually configured on the running index.
 */
export async function searchResearchGroupsViaMeili(
  query: string,
  filters: ResearchGroupFilterInput,
  page: number,
  pageSize: number,
  sort: ResearchGroupSearchSort = {},
  options: ResearchGroupSearchOptions = {},
): Promise<ResearchGroupSearchResult> {
  const safeFilters = sanitizeResearchGroupSearchFilters(filters || {});
  const safeOptions = sanitizeResearchGroupSearchOptions(options);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const safePage = Math.min(
    maxReachableResearchSearchPage(safePageSize),
    Math.max(1, Math.floor(page) || 1),
  );
  const offset = (safePage - 1) * safePageSize;

  const visibilityScopedFilters = applyVisibilityScopeToFilters(
    safeFilters,
    safeOptions.includeNonPublic,
  );
  const filterString = buildResearchGroupFilterString(visibilityScopedFilters);

  const normalizedQuery = normalizeResearchSearchQuery(query);
  const trimmedQuery = normalizedQuery.query;
  // A blank search box legitimately browses the whole corpus. A query that has
  // raw text but tokenizes to zero ASCII search terms must not silently reuse
  // that browse-all path (#958): non-Latin-script input (CJK/Arabic/Cyrillic)
  // is sent to Meilisearch as-is so its own tokenizer/embedder can match it,
  // while punctuation/symbol-only input has no searchable content and returns
  // an empty result set rather than the full directory in browse order.
  const hasUnicodeWordContent = /[\p{L}\p{N}]/u.test(normalizedQuery.raw);
  const isBrowseAllQuery = normalizedQuery.raw === '';
  // A query like "C++" or "R&D" carries its meaning in symbols that
  // `tokenizeStudentResearchQuery` treats as separators, so every resulting
  // token collapses to a single character. Meilisearch then matches that
  // 1-char token broadly against unrelated name initials instead of the
  // intended term, silently returning a large but irrelevant result set
  // (#1228). This is symbol-driven collapse, not a deliberate single-letter
  // search, so it fails closed the same way an empty tokenization does.
  const hasStrippedSymbols = /[^a-z0-9\s'’]/i.test(normalizedQuery.raw);
  const isDegenerateSymbolCollapse =
    hasStrippedSymbols &&
    normalizedQuery.tokens.length > 0 &&
    normalizedQuery.tokens.every((token) => token.length <= 1);
  const isUnsearchableQuery =
    (!isBrowseAllQuery && trimmedQuery === '' && !hasUnicodeWordContent) ||
    isDegenerateSymbolCollapse;
  const meiliQueryText = trimmedQuery !== '' ? trimmedQuery : normalizedQuery.raw;
  // Every path that was asked for facets answers with a distribution, so an
  // absent key means "unchanged, keep the copy you hold" to a paging client and
  // never leaves stale counts describing a different result set.
  const requestedFacetDistribution: Record<string, Record<string, number>> | undefined =
    safeOptions.includeFacets ? {} : undefined;
  if (isUnsearchableQuery) {
    return addResearchEntitySearchAliases(
      {
        hits: [],
        estimatedTotalHits: 0,
        page: safePage,
        pageSize: safePageSize,
        facetDistribution: requestedFacetDistribution,
        degraded: false,
      },
      { includeOperatorFields: safeOptions.includeNonPublic },
    );
  }
  if (isBrowseAllQuery && safeOptions.lowQualityFirst) {
    const candidates = withServablePublicResearchEntities(
      (await ResearchEntity.find(
        mongoFilterFromResearchFilters(safeFilters, safeOptions.includeNonPublic),
      ).lean()) as any[],
      safeFilters,
      safeOptions.includeNonPublic,
    );
    const candidatesWithQuality = await withQualitySummaries(candidates as any[]);
    const filteredCandidates = candidatesWithQuality
      .filter((entity) => matchesQualityFilters(entity.qualitySummary, safeOptions.qualityFilters))
      .sort((a, b) => {
        const scoreDiff = b.qualitySummary.score - a.qualitySummary.score;
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.displayName || a.name || '').localeCompare(
          String(b.displayName || b.name || ''),
        );
      });
    const pageEntities = filteredCandidates.slice(offset, offset + safePageSize);
    const pageEntityIds = pageEntities.map((entity) => entity._id);
    const [planningContextResult, leadMemberNamesByEntityId] = await Promise.all([
      optionalPlanningContexts(pageEntityIds),
      optionalPublicLeadMemberNames(pageEntities),
    ]);
    return addResearchEntitySearchAliases(
      {
        hits: pageEntities.map((entity) => ({
          ...entity,
          _id: researchGroupDocumentId(entity._id),
          planningContext: planningContextResult.contexts.get(researchGroupDocumentId(entity._id)),
        })),
        estimatedTotalHits: filteredCandidates.length,
        page: safePage,
        pageSize: safePageSize,
        facetDistribution: requestedFacetDistribution,
        degraded: planningContextResult.degraded,
      },
      { includeOperatorFields: safeOptions.includeNonPublic, leadMemberNamesByEntityId },
    );
  }

  const sortConfig: string[] = [];
  if (sort.sortBy) {
    const order = sort.sortOrder === 'asc' ? 'asc' : 'desc';
    sortConfig.push(`${sort.sortBy}:${order}`);
  } else if (isBrowseAllQuery) {
    // Default browse: surface the "best" research homes first — those with the
    // strongest completeness + undergrad-access signal — then fall back to
    // recency as a tiebreak. See services/researchEntityBrowseRank.ts.
    sortConfig.push('browseRankScore:desc');
    sortConfig.push('lastObservedAt:desc');
  } else {
    // Text query: Meilisearch's `sort` ranking rule runs last, so this only
    // breaks ties between comparably-relevant results. It lets the type-aware
    // browseRankScore (which demotes umbrella centers/institutes) push a broad
    // center below a lab of similar relevance without overriding relevance.
    sortConfig.push('browseRankScore:desc');
  }

  const searchParams: Record<string, any> = {
    filter: filterString,
    limit: safePageSize,
    offset,
    ...(safeOptions.includeFacets ? { facets: RESEARCH_ENTITY_SEARCH_FACET_FIELDS } : {}),
  };
  if (sortConfig.length > 0) {
    searchParams.sort = sortConfig;
  }

  const index = await getMeiliIndex('researchentities');
  if (!isBrowseAllQuery) {
    if (normalizedQuery.aliasExpansionKeepsShorthand) {
      searchParams.attributesToSearchOn = TOPIC_ALIAS_QUERY_ATTRIBUTES;
    } else if (await isResearchEntitySearchEmbedderConfigured(index)) {
      searchParams.hybrid = {
        semanticRatio: 0.8,
        embedder: 'default',
      };
      searchParams.rankingScoreThreshold = HYBRID_RANKING_SCORE_THRESHOLD;
      searchParams.showRankingScoreDetails = true;
      // Embed the query ONCE for the whole request. Meilisearch embeds `q` itself for
      // every search carrying `hybrid`, and one request issues more than one: measured
      // two for a bare query and three with two facets filtered, each embedding the
      // same string. Supplying `vector` makes Meilisearch skip its embedder, so every
      // hybrid call below reads this one value (#3149). A null falls back to today's
      // behaviour, which is why this cannot change a result.
      const queryVector = await embedSearchQuery(meiliQueryText);
      if (queryVector) searchParams.vector = queryVector;
    }
  }

  // A literal multi-word query (not an alias-expanded OR query) is a
  // conjunction: every token must match. Meilisearch defaults to the `last`
  // matching strategy, which progressively drops trailing terms when too few
  // documents match all of them, so "black hole" admits documents matching only
  // the high-frequency token "black". Require all terms for these queries so a
  // single common token cannot surface off-topic entities or inflate the count.
  // An alias expansion that is a list of OR synonyms is left permissive, because
  // no document carries them all. A shorthand that resolves to one canonical
  // phrase ("orgo" -> "organic chemistry") is the phrase the searcher meant, so
  // it is a conjunction exactly as the typed phrase is. See #1255, #2733.
  const literalPhraseQuery = !normalizedQuery.isAliasExpanded && normalizedQuery.tokens.length >= 2;
  const requireAllQueryTerms =
    !isBrowseAllQuery &&
    (literalPhraseQuery || normalizedQuery.aliasExpandsToSingleCanonicalPhrase);
  if (requireAllQueryTerms) {
    searchParams.matchingStrategy = 'all';
  }

  // Meilisearch's offset/limit `estimatedTotalHits` for a thresholded hybrid
  // query is a windowed estimate over the whole k-NN candidate pool, so it
  // reports (near) the full corpus size for broad topical queries even though
  // only a small set clears `rankingScoreThreshold`. Finite pagination
  // (`page`/`hitsPerPage`) fetches this page's hits and can itself still
  // report that inflated estimate until the requested depth happens to be
  // large enough to force an exhaustive scan (see the companion count query
  // below, which forces that scan on every request). See #885.
  const paginateHybridPoolLocally = searchParams.rankingScoreThreshold !== undefined;
  if (paginateHybridPoolLocally) {
    const hybridCandidatePoolSize = Math.min(
      RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
      Math.max(HYBRID_CANDIDATE_POOL_SIZE, offset + safePageSize),
    );
    searchParams.page = 1;
    searchParams.hitsPerPage = hybridCandidatePoolSize;
    delete searchParams.limit;
    delete searchParams.offset;
  }

  // Search, degrading gracefully on recoverable errors: drop the semantic
  // embedder if a config-drift race made it unavailable after the check above,
  // and drop the browseRankScore sort key if the running index has not yet had
  // it added to sortableAttributes. Each degradation is applied at most once;
  // anything else propagates.
  const searchWithFallbacks = async (): Promise<{
    result: {
      hits?: any[];
      estimatedTotalHits?: number;
      totalHits?: number;
      facetDistribution?: Record<string, Record<string, number>>;
    };
    degraded: boolean;
    params: Record<string, any>;
  }> => {
    // Each attempt uses an immutable params object; degrading clones rather than
    // mutating, so already-issued calls keep the params they were sent.
    let params: Record<string, any> = searchParams;
    let degraded = false;
    while (true) {
      try {
        return {
          result: await index.search(meiliQueryText, params),
          degraded,
          params,
        };
      } catch (error) {
        if (params.hybrid && isMissingMeiliEmbedderError(error)) {
          params = { ...params };
          delete params.hybrid;
          delete params.rankingScoreThreshold;
          delete params.showRankingScoreDetails;
          degraded = true;
          continue;
        }
        if (
          params.rankingScoreThreshold !== undefined &&
          isUnsupportedRankingScoreThresholdError(error)
        ) {
          params = { ...params };
          delete params.rankingScoreThreshold;
          degraded = true;
          continue;
        }
        if (Array.isArray(params.sort) && isUnsortableAttributeError(error)) {
          const filtered = params.sort.filter(
            (entry: string) => !entry.startsWith('browseRankScore'),
          );
          if (filtered.length !== params.sort.length) {
            params = { ...params };
            if (filtered.length > 0) params.sort = filtered;
            else delete params.sort;
            degraded = true;
            continue;
          }
        }
        if (params.attributesToSearchOn && isInvalidSearchAttributesToSearchOnError(error)) {
          params = { ...params };
          delete params.attributesToSearchOn;
          degraded = true;
          continue;
        }
        throw error;
      }
    }
  };
  let searchResult: {
    hits?: any[];
    estimatedTotalHits?: number;
    totalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  };
  let degraded = false;
  let finalSearchParams: Record<string, any> = searchParams;
  try {
    const outcome = await searchWithFallbacks();
    searchResult = outcome.result;
    degraded = outcome.degraded;
    finalSearchParams = outcome.params;
  } catch (error) {
    console.error(
      'ResearchEntity Meilisearch failed; falling back to Mongo search:',
      sanitizeLogValue(error),
    );
    return searchResearchGroupsViaMongoFallback(
      normalizedQuery.raw,
      safeFilters,
      safePage,
      safePageSize,
      sort,
      safeOptions,
    );
  }

  // The per-page totalHits and facetDistribution above only become exhaustive
  // once Meilisearch has scanned deep enough to have examined every candidate
  // that could pass rankingScoreThreshold, so a shallow first page can still
  // report the pre-threshold estimate/distribution over the whole k-NN
  // candidate pool. Run one companion query deep enough to force the
  // exhaustive, threshold-aware count and facet distribution regardless of
  // which page was actually requested. See #885, #941.
  if (finalSearchParams.rankingScoreThreshold !== undefined) {
    try {
      const exhaustiveCountResult = await index.search(meiliQueryText, {
        filter: filterString,
        hybrid: finalSearchParams.hybrid,
        // The request's one query vector, so this companion query does not pay a
        // second embedding for the same string (#3149).
        ...(finalSearchParams.vector ? { vector: finalSearchParams.vector } : {}),
        rankingScoreThreshold: finalSearchParams.rankingScoreThreshold,
        ...(finalSearchParams.matchingStrategy
          ? { matchingStrategy: finalSearchParams.matchingStrategy }
          : {}),
        page: 1,
        hitsPerPage: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
        attributesToRetrieve: ['id'],
        ...(safeOptions.includeFacets ? { facets: RESEARCH_ENTITY_SEARCH_FACET_FIELDS } : {}),
      });
      if (typeof exhaustiveCountResult?.totalHits === 'number') {
        searchResult = { ...searchResult, totalHits: exhaustiveCountResult.totalHits };
      }
      if (exhaustiveCountResult?.facetDistribution) {
        searchResult = {
          ...searchResult,
          facetDistribution: exhaustiveCountResult.facetDistribution,
        };
      }
    } catch (error) {
      console.error('Optional exhaustive hybrid total-hits count failed:', sanitizeLogValue(error));
    }
  }

  const {
    hits,
    estimatedTotalHits,
    totalHits,
    facetDistribution: rawFacetDistribution,
  } = searchResult;
  const resolvedTotalHits = totalHits ?? estimatedTotalHits;

  // For any facet the request is actively filtering on, recompute its
  // distribution disjunctively (excluding only its own filter clause) so the
  // dropdown keeps every sibling option and its comparative counts under the
  // other active filters. Without this, a conjunctive distribution collapses
  // the facet to just the chosen value, turning the filter into a dead end.
  // Each supplementary query mirrors the primary query's mode (hybrid +
  // threshold, topic-alias attribute scoping, or plain browse) so counts stay
  // consistent; a failure degrades to the conjunctive counts for that facet.
  const searchFacetDistributionForFilter = async (
    overrideFilterString: string,
    facetFields: string[],
  ): Promise<Record<string, Record<string, number>> | undefined> => {
    const params: Record<string, any> = { filter: overrideFilterString, facets: facetFields };
    if (finalSearchParams.attributesToSearchOn) {
      params.attributesToSearchOn = finalSearchParams.attributesToSearchOn;
    }
    if (finalSearchParams.matchingStrategy) {
      params.matchingStrategy = finalSearchParams.matchingStrategy;
    }
    if (finalSearchParams.rankingScoreThreshold !== undefined) {
      params.hybrid = finalSearchParams.hybrid;
      // One disjunctive query runs per actively filtered facet, so without the
      // request's vector each active filter costs its own embedding (#3149).
      if (finalSearchParams.vector) params.vector = finalSearchParams.vector;
      params.rankingScoreThreshold = finalSearchParams.rankingScoreThreshold;
      params.page = 1;
      params.hitsPerPage = RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS;
      params.attributesToRetrieve = ['id'];
    } else {
      params.limit = 0;
    }
    const result = (await index.search(meiliQueryText, params)) as {
      facetDistribution?: Record<string, Record<string, number>>;
    };
    return result?.facetDistribution;
  };

  const disjunctiveRawFacetDistribution = await (async (): Promise<
    Record<string, Record<string, number>> | undefined
  > => {
    if (!safeOptions.includeFacets) return undefined;
    if (!rawFacetDistribution) return rawFacetDistribution;
    const activeFacets = DISJUNCTIVE_RESEARCH_FACETS.filter(
      ({ filterKey }) => (safeFilters[filterKey]?.length ?? 0) > 0,
    );
    if (activeFacets.length === 0) return rawFacetDistribution;
    const merged: Record<string, Record<string, number>> = { ...rawFacetDistribution };
    await Promise.all(
      activeFacets.map(async ({ filterKey, meiliField }) => {
        try {
          const omittedFilterString = buildResearchGroupFilterString(
            applyVisibilityScopeToFilters(
              { ...safeFilters, [filterKey]: [] },
              safeOptions.includeNonPublic,
            ),
          );
          const distribution = await searchFacetDistributionForFilter(omittedFilterString, [
            meiliField,
          ]);
          if (distribution?.[meiliField]) merged[meiliField] = distribution[meiliField];
        } catch (error) {
          console.error(
            `Disjunctive facet computation for ${meiliField} failed; keeping conjunctive counts:`,
            sanitizeLogValue(error),
          );
        }
      }),
    );
    return merged;
  })();

  // The School filter now facets on the multi-valued `schools` field; expose it
  // to clients under the existing `school` key so the API contract is unchanged.
  const facetDistribution = ((): Record<string, Record<string, number>> | undefined => {
    if (!disjunctiveRawFacetDistribution) return disjunctiveRawFacetDistribution;
    const { schools, researchAreas, ...rest } = disjunctiveRawFacetDistribution;
    const cleanedResearchAreas = sanitizeResearchAreaFacetDistribution(researchAreas);
    return {
      ...rest,
      ...(cleanedResearchAreas ? { researchAreas: cleanedResearchAreas } : {}),
      ...(schools ? { school: schools } : {}),
    };
  })();

  // `rankingScoreThreshold` bars on the *blended* score, which gives the keyword
  // leg only 0.2 weight, and Meilisearch's `exactness` rule scores a match that
  // needed a typo corrected at 1/6, so such a match tops out near 0.02 blended:
  // the cutoff excludes every one of them however deep the candidate pool goes.
  // Lowering the cutoff does not recover them either, because they then rank
  // below thousands of weak semantic neighbours that fill the fixed pool first.
  // Measured against a local copy of the Development index: `immunolgy` matches
  // 185 documents on the keyword leg, nearly all of them documents `immunology`
  // matches too, yet its best blended score is 0.022 and its first keyword hit
  // sits at rank 585 of a 0.02-threshold result set. So the keyword leg runs as
  // its own query, where its hits compete only against each other and a
  // misspelling reaches the rows the correct spelling reaches. That ranking then
  // orders the candidate set, because the blended score the pool is sorted on
  // cannot represent a keyword hit: see `orderCandidatesByKeywordLeg`.
  //
  // It needs no ranking-score floor of its own. #823's cutoff exists because
  // hybrid k-NN returns the nearest vectors however dissimilar, which dumps the
  // corpus for a query with no real match; a keyword search instead returns
  // nothing at all for such a query (measured: zero hits for `kayaking`,
  // `origami`, `zzzzqqq`), and `dropCoincidentalTypoOnlyHits` still removes
  // partial typo garbage. See #2732.
  const keywordLegHits = await (async (): Promise<any[]> => {
    if (!finalSearchParams.hybrid || finalSearchParams.rankingScoreThreshold === undefined) {
      return [];
    }
    try {
      const keywordLegResult = await index.search(meiliQueryText, {
        filter: filterString,
        ...(finalSearchParams.sort ? { sort: finalSearchParams.sort } : {}),
        ...(finalSearchParams.matchingStrategy
          ? { matchingStrategy: finalSearchParams.matchingStrategy }
          : {}),
        showRankingScoreDetails: true,
        page: 1,
        hitsPerPage: finalSearchParams.hitsPerPage ?? HYBRID_CANDIDATE_POOL_SIZE,
      });
      return Array.isArray(keywordLegResult?.hits) ? keywordLegResult.hits : [];
    } catch (error) {
      console.error('Optional keyword-leg candidate query failed:', sanitizeLogValue(error));
      return [];
    }
  })();

  // #1015's garbage rule runs on each leg's own retrieval before the merge, so
  // ordering by the keyword leg changes rank without changing membership. A row
  // the pool admitted on semantics keeps being served when only its keyword-leg
  // copy is a coincidental typo, and it keeps the pool's position, because the
  // keyword relevance is the part that was garbage. Dropping it instead would
  // lose a match the search had already recovered. See #2732.
  const genuineKeywordLegHits = dropCoincidentalTypoOnlyHits(keywordLegHits).hits;
  const { hits: keywordFilteredHits, dropped: droppedCoincidentalHits } =
    dropCoincidentalTypoOnlyHits(orderCandidatesByKeywordLeg(hits || [], genuineKeywordLegHits));
  const reorderedPool = promoteExactAliasFieldMatches(
    floorWeakSemanticOnlyHits(keywordFilteredHits),
    normalizedQuery.aliasTerms,
  );
  // The reorder helpers run across the whole fixed candidate pool so the ordering
  // is stable, then the requested page window is sliced locally. Non-thresholded
  // queries already come back pre-paginated from Meilisearch, so they are used
  // as-is. See #1064.
  const orderedHits = paginateHybridPoolLocally
    ? reorderedPool.slice(offset, offset + safePageSize)
    : reorderedPool;
  const hitIds = orderedHits
    .map((hit: any) => hit.id || hit._id)
    .map(normalizeResearchGroupObjectId)
    .filter((id): id is string => Boolean(id));
  const visibleEntities = withServablePublicResearchEntities(
    hitIds.length > 0
      ? ((await ResearchEntity.find({
          _id: { $in: hitIds },
          archived: { $ne: true },
          ...mongoVisibilityFilter(safeFilters, safeOptions.includeNonPublic),
        }).lean()) as any[])
      : [],
    safeFilters,
    safeOptions.includeNonPublic,
  );
  const visibleEntitiesById = new Map(
    (visibleEntities as any[]).map((entity) => [researchGroupDocumentId(entity._id), entity]),
  );
  const visibleHitIds = hitIds.filter((id: any) =>
    visibleEntitiesById.has(researchGroupDocumentId(id)),
  );
  // Map Meilisearch's `id` back to `_id` for client backward compatibility. The
  // Meilisearch primary key is `serializedDocumentId(_id)`, the same serialization
  // the lead-name map is keyed by, so the DTO's per-hit lookup matches on either
  // path's `_id`.
  const [planningContextResult, leadMemberNamesByEntityId] = await Promise.all([
    optionalPlanningContexts(visibleHitIds),
    optionalPublicLeadMemberNames(visibleEntities as Array<Record<string, any>>),
  ]);
  const normalizedHits = orderedHits.flatMap((hit: any) => {
    const id = hit.id || hit._id;
    const entityId = researchGroupDocumentId(id);
    const entity = visibleEntitiesById.get(entityId);
    if (!entity) return [];
    return {
      ...entity,
      _id: id,
      planningContext: planningContextResult.contexts.get(entityId),
    };
  });

  // The companion count above counts what cleared the blended cutoff, so it omits
  // the keyword-leg rows merged into the pool. Those rows are reachable by paging
  // through the pool, and the client stops its pagination walk once a short page
  // reaches the reported total, so the locally reachable pool is a floor on the
  // count rather than something the count may fall below. See #2732.
  const locallyReachableHits = paginateHybridPoolLocally ? reorderedPool.length : 0;
  const adjustedTotalHits = Math.max(
    normalizedHits.length,
    locallyReachableHits,
    typeof resolvedTotalHits === 'number' ? resolvedTotalHits - droppedCoincidentalHits : 0,
  );

  return addResearchEntitySearchAliases(
    {
      hits: normalizedHits,
      estimatedTotalHits: adjustedTotalHits,
      page: safePage,
      pageSize: safePageSize,
      facetDistribution: facetDistribution ?? requestedFacetDistribution,
      degraded: degraded || planningContextResult.degraded,
    },
    { includeOperatorFields: safeOptions.includeNonPublic, leadMemberNamesByEntityId },
  );
}

const researchEntitySearchText = (entity: any): string =>
  [
    entity.name,
    entity.displayName,
    ...(Array.isArray(entity.leadProfessorNames) ? entity.leadProfessorNames : []),
    ...(Array.isArray(entity.professorNames) ? entity.professorNames : []),
    entity.shortDescription,
    entity.fullDescription,
    entity.summary,
    ...(Array.isArray(entity.departments) ? entity.departments : []),
    ...(Array.isArray(entity.researchAreas) ? entity.researchAreas : []),
    ...(Array.isArray(entity.keywords) ? entity.keywords : []),
    ...(Array.isArray(entity.studentSearchTerms) ? entity.studentSearchTerms : []),
    ...(Array.isArray(entity.schools) ? entity.schools : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapedRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const haystackHasTerm = (haystack: string, term: string): boolean => {
  const normalizedTerm = term.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalizedTerm) return true;
  if (normalizedTerm.length <= 3) {
    return new RegExp(`(^|\\s)${escapedRegExp(normalizedTerm)}(\\s|$)`, 'i').test(haystack);
  }
  return haystack.includes(normalizedTerm);
};

const researchEntityMatchesQuery = (entity: any, query: string): boolean => {
  const normalizedQuery = normalizeResearchSearchQuery(query);
  if (normalizedQuery.raw === '') return true;
  if (!normalizedQuery.query || normalizedQuery.tokens.length === 0) return false;
  const haystack = researchEntitySearchText(entity);
  if (normalizedQuery.aliasTerms) {
    return normalizedQuery.aliasTerms.some((alias) => haystackHasTerm(haystack, alias));
  }
  return normalizedQuery.tokens.every((token) => {
    const aliases = STUDENT_QUERY_ALIASES[token];
    if (aliases) return aliases.some((alias) => haystackHasTerm(haystack, alias));
    return haystackHasTerm(haystack, token);
  });
};

const facetCounts = (entities: any[], field: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const entity of entities) {
    const values = Array.isArray(entity?.[field]) ? entity[field] : [entity?.[field]];
    for (const value of new Set(values)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
};

const sortResearchEntitiesForMongoFallback = (
  entities: any[],
  query: string,
  sort: ResearchGroupSearchSort,
): any[] => {
  const sorted = [...entities];
  if (sort.sortBy) {
    const direction = sort.sortOrder === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      const aValue = a[sort.sortBy as string];
      const bValue = b[sort.sortBy as string];
      if (aValue instanceof Date || bValue instanceof Date) {
        return direction * (new Date(aValue || 0).getTime() - new Date(bValue || 0).getTime());
      }
      return direction * String(aValue || '').localeCompare(String(bValue || ''));
    });
    return sorted;
  }

  if (!query) {
    sorted.sort((a, b) => {
      const rankDiff = Number(b.browseRankScore || 0) - Number(a.browseRankScore || 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.lastObservedAt || 0).getTime() - new Date(a.lastObservedAt || 0).getTime();
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const observedDiff =
      new Date(b.lastObservedAt || 0).getTime() - new Date(a.lastObservedAt || 0).getTime();
    if (observedDiff !== 0) return observedDiff;
    return String(a.displayName || a.name || '').localeCompare(
      String(b.displayName || b.name || ''),
    );
  });
  return sorted;
};

const searchResearchGroupsViaMongoFallback = async (
  query: string,
  filters: ResearchGroupFilterInput,
  page: number,
  pageSize: number,
  sort: ResearchGroupSearchSort,
  options: ResearchGroupSearchOptions,
): Promise<ResearchGroupSearchResult> => {
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const safePage = Math.min(
    maxReachableResearchSearchPage(safePageSize),
    Math.max(1, Math.floor(page) || 1),
  );
  const offset = (safePage - 1) * safePageSize;
  const trimmedQuery = boundedResearchSearchQuery(query);
  const candidates = await ResearchEntity.find(
    mongoFilterFromResearchFilters(filters, options.includeNonPublic),
  ).lean();
  const visibleCandidates = withServablePublicResearchEntities(
    (candidates as any[]).filter((entity) => researchEntityMatchesQuery(entity, trimmedQuery)),
    filters,
    options.includeNonPublic,
  );
  // Mirror the Meili path's disjunctive faceting (issue #1080): a facet the
  // request is actively filtering on is counted over candidates that drop only
  // that facet's own clause, so its dropdown keeps every sibling value; other
  // active filters still constrain the counts.
  const disjunctiveMongoFacetCounts = async (
    filterKey: 'school' | 'departments' | 'researchAreas' | 'entityType',
    field: string,
  ): Promise<Record<string, number>> => {
    if (!filters[filterKey]?.length) return facetCounts(visibleCandidates, field);
    const omittedFilters = { ...filters, [filterKey]: [] };
    const omittedCandidates = (await ResearchEntity.find(
      mongoFilterFromResearchFilters(omittedFilters, options.includeNonPublic),
    ).lean()) as any[];
    const omittedVisible = withServablePublicResearchEntities(
      omittedCandidates.filter((entity) => researchEntityMatchesQuery(entity, trimmedQuery)),
      omittedFilters,
      options.includeNonPublic,
    );
    return facetCounts(omittedVisible, field);
  };
  const facetDistribution = await (async (): Promise<
    Record<string, Record<string, number>> | undefined
  > => {
    if (options.includeFacets === false) return undefined;
    const [
      schoolFacetCounts,
      departmentFacetCounts,
      researchAreaFacetCounts,
      entityTypeFacetCounts,
    ] = await Promise.all([
      disjunctiveMongoFacetCounts('school', 'schools'),
      disjunctiveMongoFacetCounts('departments', 'departments'),
      disjunctiveMongoFacetCounts('researchAreas', 'researchAreas'),
      disjunctiveMongoFacetCounts('entityType', 'entityType'),
    ]);
    return {
      school: schoolFacetCounts,
      departments: departmentFacetCounts,
      researchAreas: sanitizeResearchAreaFacetDistribution(researchAreaFacetCounts) ?? {},
      entityType: entityTypeFacetCounts,
    };
  })();
  const sortedCandidates = sortResearchEntitiesForMongoFallback(
    visibleCandidates,
    trimmedQuery,
    sort,
  );
  const pageEntities = sortedCandidates.slice(offset, offset + safePageSize);
  const leadMemberNamesByEntityId = await optionalPublicLeadMemberNames(pageEntities);
  return addResearchEntitySearchAliases(
    {
      hits: pageEntities.map((entity) => ({
        ...entity,
        _id: researchGroupDocumentId(entity._id),
      })),
      estimatedTotalHits: sortedCandidates.length,
      page: safePage,
      pageSize: safePageSize,
      facetDistribution,
      degraded: true,
    },
    { includeOperatorFields: options.includeNonPublic, leadMemberNamesByEntityId },
  ) as ResearchGroupSearchResult;
};

const MAX_PUBLIC_MEMBER_PROFILE_URLS = 20;
const PUBLIC_MEMBER_PROFILE_URL_KEY_RE = /^[a-z0-9_-]{1,64}$/i;
const PUBLIC_MEMBER_PROFILE_URL_KEYS = new Set([
  'official',
  'medicine',
  'ysm',
  'ysph',
  'department',
  'departmental',
  'directory',
  'faculty',
  'faculty-directory',
  'people',
  'yale',
]);

const hasSpecificOfficialPersonProfilePath = (pathname: string): boolean => {
  const pathSegments = pathname
    .toLowerCase()
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return (
    hasSpecificOfficialPersonPathSegment(pathSegments, 'profile') ||
    hasSpecificOfficialPersonPathSegment(pathSegments, 'profiles') ||
    hasSpecificOfficialPersonPathSegment(pathSegments, 'people') ||
    hasSpecificOfficialPersonPathSegment(pathSegments, 'person') ||
    hasSpecificOfficialPersonPathSegment(pathSegments, 'faculty') ||
    hasSpecificOfficialPersonPathSegment(pathSegments, 'faculty-directory')
  );
};

const publicOfficialYalePersonProfileUrl = (value: unknown): string | undefined => {
  const url = publicHttpUrl(value);
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const isYaleOwned = host === 'yale.edu' || host.endsWith('.yale.edu');
    if (!isYaleOwned) return undefined;
    return hasSpecificOfficialPersonProfilePath(parsed.pathname) ? url : undefined;
  } catch {
    return undefined;
  }
};

const publicMemberProfileUrlMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .flatMap(([key, rawUrl]) => {
      const normalizedKey = key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
      const url = publicOfficialYalePersonProfileUrl(rawUrl);
      return normalizedKey &&
        PUBLIC_MEMBER_PROFILE_URL_KEYS.has(normalizedKey) &&
        PUBLIC_MEMBER_PROFILE_URL_KEY_RE.test(normalizedKey) &&
        url
        ? [[normalizedKey, url] as const]
        : [];
    })
    .slice(0, MAX_PUBLIC_MEMBER_PROFILE_URLS);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const addPublicMemberProfileUrls = (target: Record<string, any>, value: unknown) => {
  const profileUrls = publicMemberProfileUrlMap(value);
  if (profileUrls) {
    target.profileUrls = profileUrls;
    target.profile_urls = profileUrls;
  }
};

const hasPublicMemberProfileUrls = (value: Record<string, any>): boolean =>
  Boolean(value.profileUrls && Object.keys(value.profileUrls).length > 0);

const addPublicMemberField = (target: Record<string, any>, key: string, value: any) => {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
};

const publicPersonNameField = (value: any): any => {
  if (typeof value !== 'string') return value;
  const withoutLifespan = stripPersonNameLifespanSuffix(value) || value;
  // Falls back to the stored value rather than dropping the name: a lead with no
  // name at all is a worse page than a lead named by a directory slug (#2385).
  return sanitizePersonName(withoutLifespan) || withoutLifespan;
};

function publicMemberKeyForResearchDetail(
  user: any,
  role?: string,
  stableIdentity?: string,
): string {
  return [
    stableIdentity || user?.displayName || [user?.fname, user?.lname].filter(Boolean).join(' '),
    role,
  ]
    .filter(Boolean)
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function publicMemberUserForResearchDetail(user: any): any {
  const publicUser: Record<string, any> = {};
  const imageUrl = user?.imageUrl || user?.image_url || '';
  const primaryDepartment = user?.primaryDepartment || user?.primary_department || '';

  addPublicMemberField(publicUser, 'fname', publicPersonNameField(user?.fname));
  addPublicMemberField(publicUser, 'lname', publicPersonNameField(user?.lname));
  addPublicMemberField(publicUser, 'displayName', publicPersonNameField(user?.displayName));
  addPublicMemberField(publicUser, 'title', sanitizePersonTitle(user?.title));
  publicUser.imageUrl = imageUrl;
  publicUser.image_url = imageUrl;
  addPublicMemberField(publicUser, 'primaryDepartment', primaryDepartment);
  addPublicMemberField(publicUser, 'primary_department', primaryDepartment);
  addPublicMemberProfileUrls(publicUser, user?.profileUrls || user?.profile_urls);
  if (!hasPublicMemberProfileUrls(publicUser)) {
    const website = publicHttpUrl(user?.websiteUrl) || publicHttpUrl(user?.website);
    if (website) {
      publicUser.website = website;
      publicUser.websiteUrl = website;
    }
  }

  return publicUser;
}

const CANONICAL_PROFILE_LINK_OFFICIAL_KINDS = new Set<ResearcherProfileLink['kind']>([
  'YALE_OFFICIAL',
]);
const CANONICAL_PROFILE_LINK_WEBSITE_KINDS = new Set<ResearcherProfileLink['kind']>([
  'LAB_ABOUT',
  'PERSONAL_ACADEMIC',
]);

const canonicalProfileLinkUrl = (
  links: readonly ResearcherProfileLink[] | undefined,
  kinds: Set<ResearcherProfileLink['kind']>,
): string | undefined => {
  if (!Array.isArray(links)) return undefined;
  for (const link of links) {
    if (
      link &&
      kinds.has(link.kind) &&
      typeof link.url === 'string' &&
      link.url.trim() &&
      isServableOfficialProfileLink(link)
    ) {
      return link.url.trim();
    }
  }
  return undefined;
};

function canonicalMemberUserForResearchDetail(entry: ResearchEntityRosterEntry): any {
  const displayName = publicPersonNameField(stripTrailingPersonNameLifespan(entry.name || ''));
  const [fallbackFirstName = '', ...rest] = displayName.split(/\s+/).filter(Boolean);
  const publicUser: Record<string, any> = {};
  const imageUrl = entry.imageUrl || '';
  const primaryDepartment = entry.primaryDepartment || '';

  addPublicMemberField(publicUser, 'fname', fallbackFirstName || undefined);
  addPublicMemberField(publicUser, 'lname', rest.join(' ') || undefined);
  addPublicMemberField(publicUser, 'displayName', displayName || undefined);
  addPublicMemberField(publicUser, 'title', sanitizePersonTitle(entry.title));
  publicUser.imageUrl = imageUrl;
  publicUser.image_url = imageUrl;
  addPublicMemberField(publicUser, 'primaryDepartment', primaryDepartment || undefined);
  addPublicMemberField(publicUser, 'primary_department', primaryDepartment || undefined);

  const officialProfileUrl = canonicalProfileLinkUrl(
    entry.profileLinks,
    CANONICAL_PROFILE_LINK_OFFICIAL_KINDS,
  );
  if (officialProfileUrl) {
    addPublicMemberProfileUrls(publicUser, { official: officialProfileUrl });
  }
  if (!hasPublicMemberProfileUrls(publicUser)) {
    const website =
      publicHttpUrl(
        canonicalProfileLinkUrl(entry.profileLinks, CANONICAL_PROFILE_LINK_WEBSITE_KINDS),
      ) || publicHttpUrl(entry.websiteUrl);
    if (website) {
      publicUser.website = website;
      publicUser.websiteUrl = website;
    }
  }

  return publicUser;
}

const canonicalRosterMemberRow = (entry: ResearchEntityRosterEntry): Record<string, any> => ({
  identityKey: researchGroupDocumentId(entry.personId),
  confidence: entry.confidence,
  reviewStatus: entry.reviewStatus,
  ...(entry.name ? { name: entry.name } : {}),
  ...(entry.rosterProvenance?.evidenceStatus
    ? { evidenceStatus: entry.rosterProvenance.evidenceStatus }
    : {}),
  ...(entry.rosterProvenance?.membershipKey
    ? { membershipKey: entry.rosterProvenance.membershipKey }
    : {}),
  ...(entry.startedAt ? { startedAt: entry.startedAt } : {}),
  ...(entry.endedAt ? { endedAt: entry.endedAt } : {}),
  ...(entry.rosterProvenance?.sourceName ? { sourceName: entry.rosterProvenance.sourceName } : {}),
  ...(entry.rosterProvenance?.sourceUrl ? { sourceUrl: entry.rosterProvenance.sourceUrl } : {}),
  ...(entry.rosterProvenance?.profileUrl ? { profileUrl: entry.rosterProvenance.profileUrl } : {}),
  ...(entry.rosterProvenance?.sectionLabel
    ? { sectionLabel: entry.rosterProvenance.sectionLabel }
    : {}),
  ...(entry.rosterProvenance?.observedAt
    ? { lastObservedAt: entry.rosterProvenance.observedAt }
    : {}),
  ...(entry.rosterProvenance?.freshnessExpiresAt
    ? { freshnessExpiresAt: entry.rosterProvenance.freshnessExpiresAt }
    : {}),
});

const publicMemberProfileImageUrl = (user: any): string => {
  const imageUrl = user?.imageUrl || user?.image_url || '';
  return isLikelyPublicProfileImageUrl(imageUrl) ? imageUrl : '';
};

async function withPublicMemberImageGuards<T extends { user: any }>(members: T[]): Promise<T[]> {
  const imageUrls = Array.from(
    new Set(members.map((member) => publicMemberProfileImageUrl(member.user)).filter(Boolean)),
  );
  if (imageUrls.length === 0) {
    return members.map((member) => ({
      ...member,
      user: { ...member.user, imageUrl: '', image_url: '' },
    }));
  }

  const sameImageResearchers = await Researcher.find({
    'profile.imageUrl': { $in: imageUrls },
    archived: { $ne: true },
  })
    .select('displayName profile.imageUrl')
    .limit(500)
    .lean();
  const sameImageUsers = sameImageResearchers.map((researcher: any) => {
    const parts = String(researcher.displayName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return {
      imageUrl: researcher.profile?.imageUrl,
      fname: parts.slice(0, -1).join(' '),
      lname: parts.length > 1 ? parts[parts.length - 1] : '',
    };
  });

  return members.map((member) => {
    const imageUrl = publicMemberProfileImageUrl(member.user);
    if (!imageUrl) {
      return { ...member, user: { ...member.user, imageUrl: '', image_url: '' } };
    }
    const shouldSuppress = isSharedProfileImageAcrossDifferentNames(
      { ...member.user, imageUrl },
      sameImageUsers as any[],
    );
    const publicImageUrl = shouldSuppress ? '' : imageUrl;
    return {
      ...member,
      user: { ...member.user, imageUrl: publicImageUrl, image_url: publicImageUrl },
    };
  });
}

const OFFICIAL_ROSTER_SOURCE_NAME = 'official-research-home-roster';
const MAX_PUBLIC_ROSTER_MEMBERS = 24;

export function isFreshVerifiedOfficialRosterRow(
  row: any,
  now = new Date(),
  enrichment?: any,
): boolean {
  if (!isVerifiedOfficialRosterRow(row, now)) return false;
  const publicationSnapshot =
    enrichment?.state === 'failed' ? enrichment?.lastSuccessfulSnapshot : enrichment;
  if (!['current', 'partial'].includes(publicationSnapshot?.state)) return false;

  const snapshotObservedAt = new Date(publicationSnapshot?.observedAt || 0);
  const rowObservedAt = new Date(row?.lastObservedAt || 0);
  const memberKeys = Array.isArray(publicationSnapshot?.memberKeys)
    ? publicationSnapshot.memberKeys
    : [];
  return (
    memberKeys.includes(row.membershipKey) &&
    row.sourceUrl === publicationSnapshot.sourceUrl &&
    Number.isFinite(snapshotObservedAt.getTime()) &&
    snapshotObservedAt.getTime() > 0 &&
    Number.isFinite(rowObservedAt.getTime()) &&
    rowObservedAt.getTime() >= snapshotObservedAt.getTime()
  );
}

function isVerifiedOfficialRosterRow(row: any, now = new Date()): boolean {
  const expiresAt = new Date(row?.freshnessExpiresAt || 0);
  return (
    row?.sourceName === OFFICIAL_ROSTER_SOURCE_NAME &&
    row?.evidenceStatus === 'verified' &&
    Boolean(row?.identityKey && row?.membershipKey && row?.name) &&
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() >= now.getTime()
  );
}

export type PublicRosterDisclosureStatus =
  | 'current'
  | 'partial'
  | 'no-verified-data'
  | 'withheld'
  | 'optional-source-failure';

export interface PublicRosterDisclosure {
  status: PublicRosterDisclosureStatus;
  returned: number;
  truncated: boolean;
  withheldCount: number;
  sourceUrl?: string;
  observedAt?: unknown;
  freshnessExpiresAt?: unknown;
}

export function publicRosterDisclosure(
  enrichment: any,
  verifiedMemberCount: number,
  availableMemberCount: number,
  retainedRows: any[] = [],
): PublicRosterDisclosure {
  const withheldCount = Math.max(0, Number(enrichment?.withheldCount) || 0);
  let status: PublicRosterDisclosureStatus;
  if (enrichment?.state === 'failed') {
    status = 'optional-source-failure';
  } else if (verifiedMemberCount > 0) {
    status = withheldCount > 0 || enrichment?.state === 'partial' ? 'partial' : 'current';
  } else if (withheldCount > 0 || enrichment?.state === 'withheld') {
    status = 'withheld';
  } else {
    status = 'no-verified-data';
  }
  const earliestRetainedValue = (field: 'lastObservedAt' | 'freshnessExpiresAt') =>
    retainedRows
      .map((row) => row?.[field])
      .filter((value) => {
        const time = new Date(value || 0).getTime();
        return Number.isFinite(time) && time > 0;
      })
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
  const retainedSnapshot =
    enrichment?.state === 'failed' ? enrichment?.lastSuccessfulSnapshot : undefined;
  const useRetainedSnapshot = Boolean(retainedSnapshot);
  const useRetainedEvidence =
    !useRetainedSnapshot && enrichment?.state === 'failed' && retainedRows.length > 0;
  return {
    status,
    returned: Math.min(verifiedMemberCount, MAX_PUBLIC_ROSTER_MEMBERS),
    truncated: availableMemberCount > MAX_PUBLIC_ROSTER_MEMBERS,
    withheldCount,
    sourceUrl: publicHttpUrl(
      useRetainedSnapshot
        ? retainedSnapshot.sourceUrl
        : useRetainedEvidence
          ? retainedRows.find((row) => row?.sourceUrl)?.sourceUrl
          : enrichment?.sourceUrl,
    ),
    observedAt: useRetainedSnapshot
      ? retainedSnapshot.observedAt
      : useRetainedEvidence
        ? earliestRetainedValue('lastObservedAt')
        : enrichment?.observedAt,
    freshnessExpiresAt: useRetainedSnapshot
      ? retainedSnapshot.freshnessExpiresAt
      : useRetainedEvidence
        ? earliestRetainedValue('freshnessExpiresAt')
        : enrichment?.freshnessExpiresAt,
  };
}

export const PUBLIC_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

const PUBLIC_LEAD_CANONICAL_ROLES = Array.from(PUBLIC_LEAD_ROLES).flatMap((legacyRole) => {
  const canonicalRole = canonicalRoleForLegacy(legacyRole);
  return canonicalRole ? [canonicalRole] : [];
});

export const currentResearchEntityMemberFilter = (researchEntityId: unknown) => ({
  researchEntityId,
  archived: { $ne: true },
  isCurrentMember: { $ne: false },
});

const MAX_PUBLIC_DETAIL_MEMBERS = 100;
const MAX_PUBLIC_DETAIL_ACCESS_SIGNALS = 50;
const MAX_PUBLIC_DETAIL_RELATIONSHIPS_PER_DIRECTION = 50;
const MAX_PUBLIC_DETAIL_RELATIONSHIP_QUERY_LIMIT = 51;
// `rosterEnrichment` is here because the lead-name derivation these rails now run
// reads it to decide whether an official-roster row is still fresh, and that check
// fails CLOSED on a field it cannot see. Unprojected, it would silently drop every
// official-roster lead, hand the copy sanitizer a short lead list, and make a rail
// card strip the very name its own detail page keeps (#2240).
export const PUBLIC_RELATED_ENTITY_PROJECTION = withPublicDescriptionGateFields(
  '_id slug departments studentVisibilityTier rosterEnrichment',
);

const MAX_SIMILAR_RESEARCH_ENTITIES = 6;
const SIMILAR_RESEARCH_ENTITY_CANDIDATE_POOL = 40;
// searchSimilarDocuments returns the k nearest vectors regardless of how
// dissimilar they are, so a niche entity with no real topical neighbor would
// otherwise surface arbitrary homes. This pure-cosine cutoff drops those weak
// neighbors so the section stays absent unless a genuinely similar home exists.
const SIMILAR_RESEARCH_ENTITY_SIMILARITY_THRESHOLD = 0.35;

export interface PublicRelationshipCollectionMeta {
  returned: number;
  truncated: boolean;
}

const dedupePublicResearchEntitiesInOrder = (
  orderedEntityIds: unknown[],
  entitiesByInternalId: Map<string, PublicResearchEntitySummaryDto>,
): PublicResearchEntitySummaryDto[] => {
  const seenCanonicalKeys = new Set<string>();
  const uniqueEntities: PublicResearchEntitySummaryDto[] = [];
  for (const entityId of orderedEntityIds) {
    const entity = entitiesByInternalId.get(researchGroupDocumentId(entityId));
    if (!entity) continue;
    const canonicalKey = entity.slug || entity.id;
    if (!canonicalKey || seenCanonicalKeys.has(canonicalKey)) continue;
    seenCanonicalKeys.add(canonicalKey);
    uniqueEntities.push(entity);
  }
  return uniqueEntities;
};

const publicRelationshipForResearchDetail = (
  relationship: any,
  relatedResearchEntity?: PublicResearchEntitySummaryDto,
) => ({
  relatedResearchEntityId: relatedResearchEntity?.id || relatedResearchEntity?.slug,
  relatedResearchEntitySlug: relatedResearchEntity?.slug,
  relationshipType: relationship.relationshipType,
  label: relationship.label,
  evidenceStrength: relationship.evidenceStrength,
  sourceUrl: publicHttpUrl(relationship.sourceUrl),
  confidence: relationship.confidence,
  lastObservedAt: relationship.lastObservedAt,
});

export async function listResearchEntityRelationshipPayload(entityId: unknown): Promise<{
  entityRelationships: any[];
  relatedResearchEntities: PublicResearchEntitySummaryDto[];
  relatedResearchEntitiesMeta: PublicRelationshipCollectionMeta;
  affiliatedRelationships: any[];
  affiliatedResearchEntities: PublicResearchEntitySummaryDto[];
  affiliatedResearchEntitiesMeta: PublicRelationshipCollectionMeta;
}> {
  const safeEntityId = normalizeResearchGroupObjectId(entityId);
  if (!safeEntityId) {
    return {
      entityRelationships: [],
      relatedResearchEntities: [],
      relatedResearchEntitiesMeta: { returned: 0, truncated: false },
      affiliatedRelationships: [],
      affiliatedResearchEntities: [],
      affiliatedResearchEntitiesMeta: { returned: 0, truncated: false },
    };
  }

  const [relatedRelationshipsAll, affiliatedRelationshipsAll] = (await Promise.all([
    ResearchEntityRelationship.find({
      archived: { $ne: true },
      sourceResearchEntityId: safeEntityId,
    })
      .sort({ confidence: -1, updatedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_RELATIONSHIP_QUERY_LIMIT)
      .lean(),
    ResearchEntityRelationship.find({
      archived: { $ne: true },
      targetResearchEntityId: safeEntityId,
    })
      .sort({ confidence: -1, updatedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_RELATIONSHIP_QUERY_LIMIT)
      .lean(),
  ])) as [any[], any[]];
  const relatedRelationships = relatedRelationshipsAll.slice(
    0,
    MAX_PUBLIC_DETAIL_RELATIONSHIPS_PER_DIRECTION,
  );
  const affiliatedRelationships = affiliatedRelationshipsAll.slice(
    0,
    MAX_PUBLIC_DETAIL_RELATIONSHIPS_PER_DIRECTION,
  );
  const relatedEntityIds = relatedRelationships.map(
    (relationship) => relationship.targetResearchEntityId,
  );
  const affiliatedEntityIds = affiliatedRelationships.map(
    (relationship) => relationship.sourceResearchEntityId,
  );
  const entityIds = Array.from(
    new Set(
      [...relatedEntityIds, ...affiliatedEntityIds]
        .map(normalizeResearchGroupObjectId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const relatedEntities =
    entityIds.length > 0
      ? await ResearchEntity.find({
          _id: { $in: entityIds },
          archived: { $ne: true },
          studentVisibilityTier: { $in: publicStudentVisibilityTiers },
        })
          .select(PUBLIC_RELATED_ENTITY_PROJECTION)
          .lean()
      : [];
  const publicRelatedEntities = withServablePublicResearchEntities(
    (relatedEntities as any[]).filter((entity) =>
      publicStudentVisibilityTiers.includes(entity.studentVisibilityTier),
    ),
    {},
    false,
  );

  const relatedLeadNamesByEntityId = await optionalPublicLeadMemberNames(publicRelatedEntities);
  const publicEntitiesByInternalId = new Map(
    publicRelatedEntities.map((entity) => {
      const entityId = researchGroupDocumentId(entity._id);
      const leadMemberNames = relatedLeadNamesByEntityId.get(entityId) || [];
      return [
        entityId,
        toPublicResearchEntitySummaryDto(
          sanitizeResearchEntityPublicDescriptionFields(entity, leadMemberNames),
          leadMemberNames,
        ),
      ];
    }),
  );

  const relatedResearchEntities = dedupePublicResearchEntitiesInOrder(
    relatedEntityIds,
    publicEntitiesByInternalId,
  );
  const affiliatedResearchEntities = dedupePublicResearchEntitiesInOrder(
    affiliatedEntityIds,
    publicEntitiesByInternalId,
  );

  return {
    entityRelationships: relatedRelationships
      .map((relationship) => ({
        relationship,
        relatedResearchEntity: publicEntitiesByInternalId.get(
          researchGroupDocumentId(relationship.targetResearchEntityId),
        ),
      }))
      .filter(({ relatedResearchEntity }) => Boolean(relatedResearchEntity))
      .map(({ relationship, relatedResearchEntity }) =>
        publicRelationshipForResearchDetail(relationship, relatedResearchEntity),
      ),
    relatedResearchEntities,
    relatedResearchEntitiesMeta: {
      returned: relatedResearchEntities.length,
      truncated: relatedRelationshipsAll.length > relatedRelationships.length,
    },
    affiliatedRelationships: affiliatedRelationships
      .map((relationship) => ({
        relationship,
        relatedResearchEntity: publicEntitiesByInternalId.get(
          researchGroupDocumentId(relationship.sourceResearchEntityId),
        ),
      }))
      .filter(({ relatedResearchEntity }) => Boolean(relatedResearchEntity))
      .map(({ relationship, relatedResearchEntity }) =>
        publicRelationshipForResearchDetail(relationship, relatedResearchEntity),
      ),
    affiliatedResearchEntities,
    affiliatedResearchEntitiesMeta: {
      returned: affiliatedResearchEntities.length,
      truncated: affiliatedRelationshipsAll.length > affiliatedRelationships.length,
    },
  };
}

/**
 * "More like this": up to N other student-visible research homes whose topical
 * embedding is closest to the viewed entity, reusing the existing Meili semantic
 * embedder via searchSimilarDocuments (no new index, embedder, or data). Results
 * are projected through the same bounded summary allowlist as the structural
 * relation sections, and exclude the entity itself, any caller-supplied
 * structural relations, archived entities, and anything below the public tier.
 */
export async function listSimilarResearchEntities(
  entity: Record<string, any>,
  options: { excludeEntityKeys?: Iterable<unknown>; limit?: number } = {},
): Promise<PublicResearchEntitySummaryDto[]> {
  const entityId = researchGroupDocumentId(entity?._id ?? entity?.id);
  if (!entityId) return [];

  const requestedLimit = Math.floor(options.limit ?? MAX_SIMILAR_RESEARCH_ENTITIES);
  const limit = Math.min(
    MAX_SIMILAR_RESEARCH_ENTITIES,
    Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : MAX_SIMILAR_RESEARCH_ENTITIES),
  );

  const index = await getMeiliIndex('researchentities');
  if (!(await isResearchEntitySearchEmbedderConfigured(index))) return [];

  const exclusionKeys = new Set<string>();
  const addExclusion = (value: unknown): void => {
    const key = String(value ?? '')
      .trim()
      .toLowerCase();
    if (key) exclusionKeys.add(key);
  };
  addExclusion(entityId);
  addExclusion(entity?.slug);
  for (const key of options.excludeEntityKeys ?? []) addExclusion(key);

  const visibilityFilter = [
    'archived != true',
    `studentVisibilityTier IN [${publicStudentVisibilityTiers.map((tier) => `"${tier}"`).join(', ')}]`,
  ].join(' AND ');

  let hits: any[];
  try {
    const result = await (index as any).searchSimilarDocuments({
      id: entityId,
      embedder: RESEARCH_ENTITY_SEARCH_EMBEDDER_NAME,
      limit: SIMILAR_RESEARCH_ENTITY_CANDIDATE_POOL,
      filter: visibilityFilter,
      showRankingScore: true,
    });
    hits = Array.isArray(result?.hits) ? result.hits : [];
  } catch (error) {
    // "More like this" is an additive discovery surface layered on the existing
    // semantic index. If the running Meili index lacks the embedder or rejects
    // the similar-documents request, hide the section rather than fail the page.
    console.error('Similar research entities lookup failed:', sanitizeLogValue(error));
    return [];
  }

  const isExcludedKey = (...values: unknown[]): boolean =>
    values.some((value) => {
      const key = String(value ?? '')
        .trim()
        .toLowerCase();
      return Boolean(key) && exclusionKeys.has(key);
    });

  const orderedCandidateIds: string[] = [];
  const seenCandidateIds = new Set<string>();
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue;
    if (
      typeof hit._rankingScore === 'number' &&
      hit._rankingScore < SIMILAR_RESEARCH_ENTITY_SIMILARITY_THRESHOLD
    ) {
      continue;
    }
    if (isExcludedKey(hit.id, hit.slug)) continue;
    const candidateId = normalizeResearchGroupObjectId(hit.id ?? hit._id);
    if (!candidateId || seenCandidateIds.has(candidateId)) continue;
    seenCandidateIds.add(candidateId);
    orderedCandidateIds.push(candidateId);
  }
  if (orderedCandidateIds.length === 0) return [];

  // The index document is a materialized snapshot carrying its own sanitizer
  // (`sanitizeResearchEntityIndexDocument`), so it decides only WHICH entities are
  // similar and in what order. Servability and card copy are re-derived from Mongo
  // through the same live gate the detail resolver runs, because a stored
  // `student_ready` tier can go stale and the index sanitizer diverges from the
  // serve path in both directions (#2395). Reading the hit directly rendered copy
  // no other surface would show, for a row that may no longer serve.
  const candidateEntities = (await ResearchEntity.find({
    _id: { $in: orderedCandidateIds },
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select(PUBLIC_RELATED_ENTITY_PROJECTION)
    .lean()) as any[];

  const summaryCandidates = withServablePublicResearchEntities(candidateEntities, {}, false).filter(
    (candidate) => !isExcludedKey(researchGroupDocumentId(candidate._id), candidate.slug),
  );
  const candidateLeadNamesByEntityId = await optionalPublicLeadMemberNames(summaryCandidates);
  const summariesByInternalId = new Map(
    summaryCandidates.map((candidate) => {
      const entityId = researchGroupDocumentId(candidate._id);
      const leadMemberNames = candidateLeadNamesByEntityId.get(entityId) || [];
      return [
        entityId,
        toPublicResearchEntitySummaryDto(
          sanitizeResearchEntityPublicDescriptionFields(candidate, leadMemberNames),
          leadMemberNames,
        ),
      ];
    }),
  );

  return dedupePublicResearchEntitiesInOrder(orderedCandidateIds, summariesByInternalId).slice(
    0,
    limit,
  );
}

function normalizedMemberName(member: { user?: any }): string {
  return [member.user?.fname, member.user?.lname]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function memberDisplayName(member: { user?: any }): string {
  return String(
    member.user?.displayName ||
      [member.user?.fname, member.user?.lname].filter(Boolean).join(' ') ||
      member.user?.name ||
      '',
  ).trim();
}

export function researchDetailLeadIdentity(
  group: Record<string, any>,
  members: Array<{ user: any; role: string; row?: any }>,
): { leadIdentityStatus: 'verified' | 'under_review'; leadProfessorPublicKey?: string } {
  const leadMembers = members.filter((member) => PUBLIC_LEAD_ROLES.has(member.role));
  if (leadMembers.some((member) => member.row?.reviewStatus === 'DISPUTED')) {
    return { leadIdentityStatus: 'under_review' };
  }
  if (leadMembers.some((member) => personNameHasLifespanSuffix(memberDisplayName(member)))) {
    return { leadIdentityStatus: 'under_review' };
  }
  const entityProfileDestinations = entityOfficialPersonProfileDestinations(group);
  const matchingMembers = leadMembers.filter((member) =>
    entityProfileDestinations.has(
      normalizeOfficialProfileDestination(resolveLeadOfficialProfileUrl(member)),
    ),
  );

  if (detectProfileIdentityRisk({ entity: group, leadMembers })) {
    return { leadIdentityStatus: 'under_review' };
  }

  return {
    leadIdentityStatus: 'verified',
    ...(matchingMembers.length === 1
      ? {
          leadProfessorPublicKey: publicMemberKeyForResearchDetail(
            matchingMembers[0].user,
            matchingMembers[0].role,
            matchingMembers[0].row?.identityKey,
          ),
        }
      : {}),
  };
}

function normalizedWordsForMatch(value: unknown): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function departmentMatchScore(user: any, group: any): number {
  const departments: string[] = (Array.isArray(group?.departments) ? group.departments : [])
    .flatMap(normalizedWordsForMatch)
    .filter((word: string) => word.length > 2);
  if (departments.length === 0) return 0;

  const primary: string[] = normalizedWordsForMatch(user?.primaryDepartment);
  const secondary: string[] = (
    Array.isArray(user?.secondaryDepartments) ? user.secondaryDepartments : []
  ).flatMap(normalizedWordsForMatch);

  if (departments.some((word: string) => primary.includes(word))) return 30;
  if (departments.some((word: string) => secondary.includes(word))) return 12;
  return 0;
}

function memberEvidenceScore(member: { user: any; role: string; row?: any }, group: any): number {
  const user = member.user || {};
  const row = member.row || {};
  const contactEmail = String(group?.contactEmail || '')
    .trim()
    .toLowerCase();
  const email = String(user.email || '')
    .trim()
    .toLowerCase();
  const contactNetid = contactEmail.endsWith('@yale.edu')
    ? contactEmail.replace(/@yale\.edu$/, '')
    : '';
  const netid = String(user.netid || '')
    .trim()
    .toLowerCase();
  const sourceUrl = String(row.sourceUrl || '').trim();

  return (
    (contactEmail && email === contactEmail ? 100 : 0) +
    (contactNetid && netid === contactNetid ? 90 : 0) +
    departmentMatchScore(user, group) +
    (sourceUrl && (group?.sourceUrls || []).includes(sourceUrl) ? 16 : 0) +
    (sourceUrl ? 8 : 0) +
    (Number(row.confidence) || 0)
  );
}

const SAME_PERSON_LEAD_ROLE_PRIORITY = new Map([
  ['pi', 0],
  ['co-pi', 1],
  ['director', 2],
  ['co-director', 3],
]);

function samePersonLeadRoleKey(member: { user: any; role: string }): string {
  const user = member.user || {};
  const name = normalizedMemberName(member);
  const title = normalizedWordsForMatch(user.title).join(' ');
  const department = normalizedWordsForMatch(
    user.primaryDepartment || user.primary_department,
  ).join(' ');
  const image = String(user.imageUrl || user.image_url || '')
    .trim()
    .toLowerCase();
  return [name, title, department, image].filter(Boolean).join('|');
}

function shouldCollapseSamePersonLeadRoles(roles: Set<string>): boolean {
  return roles.has('pi') && (roles.has('director') || roles.has('co-director'));
}

export function dedupeSameNameLeadMembers<T extends { user: any; role: string; row?: any }>(
  members: T[],
  group: any,
): T[] {
  const duplicateKeys = new Set<string>();
  const buckets = new Map<string, T[]>();

  for (const member of members) {
    if (!PUBLIC_LEAD_ROLES.has(member.role)) continue;
    const name = normalizedMemberName(member);
    if (!name) continue;
    const key = `${member.role}:${name}`;
    buckets.set(key, [...(buckets.get(key) || []), member]);
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.length > 1) duplicateKeys.add(key);
  }

  const samePersonDuplicateKeys = new Set<string>();
  const samePersonBuckets = new Map<string, T[]>();
  for (const member of members) {
    if (!PUBLIC_LEAD_ROLES.has(member.role)) continue;
    const key = samePersonLeadRoleKey(member);
    if (!key) continue;
    samePersonBuckets.set(key, [...(samePersonBuckets.get(key) || []), member]);
  }

  for (const [key, bucket] of samePersonBuckets.entries()) {
    const roles = new Set(bucket.map((member) => member.role));
    if (bucket.length > 1 && shouldCollapseSamePersonLeadRoles(roles)) {
      samePersonDuplicateKeys.add(key);
    }
  }

  if (duplicateKeys.size === 0 && samePersonDuplicateKeys.size === 0) return members;

  const keepByKey = new Map<string, T>();
  for (const key of duplicateKeys) {
    const bucket = buckets.get(key) || [];
    keepByKey.set(
      key,
      [...bucket].sort((a, b) => {
        const byScore = memberEvidenceScore(b, group) - memberEvidenceScore(a, group);
        if (byScore !== 0) return byScore;
        return researchGroupDocumentId(a.user?._id).localeCompare(
          researchGroupDocumentId(b.user?._id),
        );
      })[0],
    );
  }

  const keepBySamePersonKey = new Map<string, T>();
  for (const key of samePersonDuplicateKeys) {
    const bucket = samePersonBuckets.get(key) || [];
    keepBySamePersonKey.set(
      key,
      [...bucket].sort((a, b) => {
        const byRole =
          (SAME_PERSON_LEAD_ROLE_PRIORITY.get(a.role) ?? 99) -
          (SAME_PERSON_LEAD_ROLE_PRIORITY.get(b.role) ?? 99);
        if (byRole !== 0) return byRole;
        const byScore = memberEvidenceScore(b, group) - memberEvidenceScore(a, group);
        if (byScore !== 0) return byScore;
        return researchGroupDocumentId(a.user?._id).localeCompare(
          researchGroupDocumentId(b.user?._id),
        );
      })[0],
    );
  }

  return members.filter((member) => {
    const key = `${member.role}:${normalizedMemberName(member)}`;
    const samePersonKey = samePersonLeadRoleKey(member);
    return (
      (!duplicateKeys.has(key) || keepByKey.get(key) === member) &&
      (!samePersonDuplicateKeys.has(samePersonKey) ||
        keepBySamePersonKey.get(samePersonKey) === member)
    );
  });
}

const isCorroboratedLeadMember = (member: { role: string; row?: any }): boolean =>
  PUBLIC_LEAD_ROLES.has(member.role) && (Number(member.row?.confidence) || 0) > 0;

const isUncorroboratedPhantomLeadMember = (member: { role: string; row?: any }): boolean => {
  if (!PUBLIC_LEAD_ROLES.has(member.role)) return false;
  const confidence = Number(member.row?.confidence) || 0;
  const reviewStatus = String(member.row?.reviewStatus || '');
  const hasEvidence = Boolean(member.row?.evidenceStatus);
  return confidence === 0 && reviewStatus === 'UNREVIEWED' && !hasEvidence;
};

export function dropUncorroboratedPhantomLeads<T extends { role: string; row?: any }>(
  members: T[],
): T[] {
  if (!members.some(isCorroboratedLeadMember)) return members;
  return members.filter((member) => !isUncorroboratedPhantomLeadMember(member));
}

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    if (!isPublicHttpUrl(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

const MAX_PUBLIC_DETAIL_TEXT_LENGTH = 5000;

const publicString = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? redactDirectContactInfo(value.slice(0, MAX_PUBLIC_DETAIL_TEXT_LENGTH))
    : undefined;

const publicResearchDetailSourceUrl = (value: unknown, entity?: any): string | undefined => {
  const url = publicHttpUrl(value);
  if (!url || isDisallowedResearchEntitySourceUrl(url, entity)) return undefined;
  return url;
};

const publicAccessSignalForResearchDetail = (signal: any, entity?: any) => ({
  signalType: signal.type,
  confidence: signal.confidence,
  confidenceScore: signal.confidenceScore,
  excerpt: publicString(signal.source?.excerpt),
  sourceUrl: publicResearchDetailSourceUrl(signal.source?.url, entity),
  observedAt: signal.observedAt,
});

/**
 * Narrows a whole research-entity document to what the detail response may carry.
 *
 * What this withholds must stay disjoint from
 * `RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS`. Withholding a gate input here
 * does not keep it out of the payload - the public DTO is an allowlist builder and
 * already omits every field it does not name - it only starves the serve-time
 * sanitizer the DTO runs, which then judges the entity on values it cannot see.
 * `fieldProvenance` is the field that proved the point: withholding it here made
 * the chip-coherence pass read every sourced `researchAreas` chip as unsourced and
 * drop the ones it judged domain-incoherent (#2898). It is retained and never
 * served; only the derived contribution labels are public.
 *
 * `sourceUrls` is the same lesson on a field the DTO does name: narrowing the list
 * here hid the shared academic host root from `servedPersonScopedDisplayName`, which
 * then served the host organization's name as the card heading (#2360). The DTO owns
 * that narrowing now (`publicResearchEntitySourceUrls`), so this projection hands it
 * the row's citations intact.
 */
export const publicResearchDetailGroup = (group: any) => {
  const {
    contactEmail: _contactEmail,
    contactName: _contactName,
    contactRole: _contactRole,
    contactPhone: _contactPhone,
    email: _email,
    phone: _phone,
    rosterEnrichment: _rosterEnrichment,
    sourceLinkHealth: rawSourceLinkHealth,
    ...publicGroup
  } = group || {};
  return {
    ...publicGroup,
    sourceLinkHealth: publicSourceLinkHealthArray(rawSourceLinkHealth),
    sourceFieldContributions: buildSourceFieldContributions(
      publicGroup.fieldProvenance,
      (url) => !isDisallowedResearchEntitySourceUrl(url, publicGroup),
    ),
  };
};

export const MAX_RESEARCH_DETAIL_SLUG_LENGTH = 160;
const RESEARCH_DETAIL_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/i;

export const normalizeResearchDetailSlug = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_RESEARCH_DETAIL_SLUG_LENGTH) return undefined;
  return RESEARCH_DETAIL_SLUG_PATTERN.test(trimmed) ? trimmed : undefined;
};

const isPubliclyServableCanonicalTarget = (candidate: Record<string, any>): boolean =>
  candidate.archived !== true &&
  !!candidate.studentVisibilityTier &&
  publicStudentVisibilityTiers.includes(candidate.studentVisibilityTier as StudentVisibilityTier) &&
  !researchEntityHasDeceasedLead(candidate) &&
  typeof candidate.slug === 'string' &&
  candidate.slug.trim().length > 0;

const PUBLIC_DETAIL_ROLE_PRIORITY: Record<string, number> = {
  pi: 0,
  'co-pi': 1,
  director: 2,
  'co-director': 3,
  'core-faculty': 4,
  affiliated: 5,
  alumni: 6,
};

/**
 * The public roster a detail page renders, derived from raw roster entries: drop
 * historical rows and stale official-roster rows, map to canonical member users,
 * and collapse duplicate identity-key/role pairs.
 *
 * Single-owner because browse now derives lead names for its own card copy from the
 * same entries. A looser derivation there would hand the copy sanitizer a different
 * lead set than the detail page's, and the two surfaces would serve two strings for
 * one row again, which is the defect #2240 exists to close.
 */
function canonicalPublicDetailMembers(
  entity: Record<string, any>,
  rosterEntries: ResearchEntityRosterEntry[],
  now = new Date(),
): Array<{ user: any; role: string; row: Record<string, any> }> {
  return rosterEntries
    .filter((entry) => entry.state !== 'HISTORICAL')
    .filter(
      (entry) =>
        entry.rosterProvenance?.sourceName !== OFFICIAL_ROSTER_SOURCE_NAME ||
        isFreshVerifiedOfficialRosterRow(
          canonicalRosterMemberRow(entry),
          now,
          entity.rosterEnrichment,
        ),
    )
    .sort(
      (a, b) =>
        (PUBLIC_DETAIL_ROLE_PRIORITY[a.role] ?? 99) - (PUBLIC_DETAIL_ROLE_PRIORITY[b.role] ?? 99),
    )
    .slice(0, MAX_PUBLIC_DETAIL_MEMBERS)
    .map((entry) => ({
      user: canonicalMemberUserForResearchDetail(entry),
      role: entry.role,
      row: canonicalRosterMemberRow(entry),
    }))
    .filter((member) => Boolean(member.user.displayName || member.user.fname || member.user.lname))
    .filter((member, index, rows) => {
      const key = `${(member.row.identityKey || '').toLowerCase()}:${member.role}`;
      return (
        index ===
        rows.findIndex(
          (candidate) =>
            `${(candidate.row.identityKey || '').toLowerCase()}:${candidate.role}` === key,
        )
      );
    })
    .sort(
      (a, b) =>
        (PUBLIC_DETAIL_ROLE_PRIORITY[a.role] ?? 99) - (PUBLIC_DETAIL_ROLE_PRIORITY[b.role] ?? 99),
    );
}

const publicLeadMemberNames = (members: Array<{ user?: any; role: string }>): string[] =>
  members
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => memberDisplayName(member))
    .filter(Boolean);

/**
 * The lead display names a serve path must hand the copy sanitizer, derived from one
 * entity document and its raw roster entries through exactly the chain the detail
 * page runs. The image guard the detail page also applies is deliberately skipped:
 * it only ever rewrites image URLs, never membership, so it cannot change a name.
 */
export function publicResearchEntityLeadMemberNames(
  entity: Record<string, any>,
  rosterEntries: ResearchEntityRosterEntry[],
  now = new Date(),
): string[] {
  const canonicalMembers = canonicalPublicDetailMembers(entity, rosterEntries, now);
  return publicLeadMemberNames(
    dedupeSameNameLeadMembers(dropUncorroboratedPhantomLeads(canonicalMembers), entity),
  );
}

export async function resolveArchivedResearchEntityCanonicalSlug(
  slug: string,
): Promise<string | null> {
  const normalizedSlug = normalizeResearchDetailSlug(slug);
  if (!normalizedSlug) return null;

  const mergedShell = (await ResearchEntity.findOne({
    slug: normalizedSlug,
    archived: true,
    canonicalGroupId: { $ne: null },
  })
    .select('_id canonicalGroupId')
    .lean()) as {
    _id?: mongoose.Types.ObjectId;
    canonicalGroupId?: mongoose.Types.ObjectId;
  } | null;

  const canonical = await resolveResearchEntityCanonicalIdentity({
    slug: normalizedSlug,
    entityId: mergedShell?._id,
    isAcceptableCanonical: isPubliclyServableCanonicalTarget,
  });

  const canonicalSlug = typeof canonical?.slug === 'string' ? canonical.slug.trim() : '';
  if (!canonicalSlug || canonicalSlug === normalizedSlug) return null;
  return canonicalSlug;
}

export async function getResearchGroupDetail(slug: string): Promise<{
  researchEntity: PublicResearchEntityDto;
  members: Array<{ user: any; role: string }>;
  roster: PublicRosterDisclosure;
  accessSignals: any[];
  departmentCourseCreditRoutes: PublicDepartmentCourseCreditRoute[];
  entityRelationships: any[];
  relatedResearchEntities: PublicResearchEntitySummaryDto[];
  relatedResearchEntitiesMeta: PublicRelationshipCollectionMeta;
  affiliatedRelationships: any[];
  affiliatedResearchEntities: PublicResearchEntitySummaryDto[];
  affiliatedResearchEntitiesMeta: PublicRelationshipCollectionMeta;
  similarResearchEntities: PublicResearchEntitySummaryDto[];
} | null> {
  const normalizedSlug = normalizeResearchDetailSlug(slug);
  if (!normalizedSlug) return null;

  const group = await ResearchEntity.findOne({
    slug: normalizedSlug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();
  if (!group) return null;
  if (researchEntityHasDeceasedLead(group as Record<string, any>)) return null;

  const rosterEntries = await getResearchEntityRoster((group as any)._id);
  const canonicalMembers = canonicalPublicDetailMembers(
    group as Record<string, any>,
    rosterEntries,
  );
  const corroboratedMembers = dropUncorroboratedPhantomLeads(canonicalMembers);
  const imageGuardedMembersWithRows = await withPublicMemberImageGuards(corroboratedMembers);
  const dedupedMembersWithRows = dedupeSameNameLeadMembers(imageGuardedMembersWithRows, group);
  const leadIdentity = researchDetailLeadIdentity(
    group as Record<string, any>,
    dedupedMembersWithRows,
  );
  const leadMemberNames = publicLeadMemberNames(dedupedMembersWithRows);
  const publicDescription = buildResearchEntityPublicDescriptionRepresentation({
    entity: group as any,
    leadMemberNames,
  });
  if (!publicDescription.invariant.pass) return null;
  const publicGroup = publicDescription.entity;
  const availableRosterMembers = dedupedMembersWithRows.filter((member) =>
    isFreshVerifiedOfficialRosterRow(member.row, new Date(), (group as any).rosterEnrichment),
  );
  const publicRosterMembers = availableRosterMembers.slice(0, MAX_PUBLIC_ROSTER_MEMBERS);
  const publicRosterMemberRows = new Set(publicRosterMembers.map((member) => member.row));
  const boundedMembersWithRows = dedupedMembersWithRows.filter(
    (member) =>
      member.row?.sourceName !== OFFICIAL_ROSTER_SOURCE_NAME ||
      publicRosterMemberRows.has(member.row),
  );
  const members = boundedMembersWithRows.map(({ row, ...member }) => {
    const rosterEvidence = isFreshVerifiedOfficialRosterRow(
      row,
      new Date(),
      (group as any).rosterEnrichment,
    )
      ? {
          sourceUrl: publicHttpUrl(row.sourceUrl),
          profileUrl: publicHttpUrl(row.profileUrl),
          observedAt: row.lastObservedAt,
          freshnessExpiresAt: row.freshnessExpiresAt,
        }
      : undefined;
    return {
      ...member,
      user: {
        ...publicMemberUserForResearchDetail(member.user),
        publicKey: publicMemberKeyForResearchDetail(member.user, member.role, row?.identityKey),
      },
      ...(rosterEvidence ? { rosterEvidence } : {}),
    };
  });
  const roster = publicRosterDisclosure(
    (group as any).rosterEnrichment,
    publicRosterMembers.length,
    availableRosterMembers.length,
    availableRosterMembers.map((member) => member.row),
  );
  const [accessSignals, planningContexts, departmentCourseCreditRoutes] = await Promise.all([
    Signal.find({
      researchEntityId: (group as any)._id,
      type: { $in: accessSignalTypes },
      archived: false,
    })
      .sort({ observedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_ACCESS_SIGNALS)
      .lean(),
    optionalPlanningContexts([(group as any)._id]),
    optionalDepartmentCourseCreditRoutes(((group as any).departments || []) as string[]),
  ]);

  const publicGroupForResponse = publicResearchDetailGroup({
    ...publicGroup,
    fieldProvenance: (group as any).fieldProvenance,
  });
  const publicAccessSignals = (accessSignals as any[]).map((signal) =>
    publicAccessSignalForResearchDetail(signal, group),
  );
  const relationshipPayload = await listResearchEntityRelationshipPayload((group as any)._id);
  const structuralRelationExclusionKeys = [
    ...relationshipPayload.relatedResearchEntities,
    ...relationshipPayload.affiliatedResearchEntities,
  ].flatMap((related) => [related.slug, related.id]);
  const similarResearchEntities = await listSimilarResearchEntities(group as Record<string, any>, {
    excludeEntityKeys: structuralRelationExclusionKeys,
  });

  return addResearchEntityDetailAlias(
    {
      group: {
        ...publicGroupForResponse,
        ...leadIdentity,
        planningContext: planningContexts.contexts.get(researchGroupDocumentId((group as any)._id)),
      },
      members,
      roster,
      accessSignals: publicAccessSignals,
      departmentCourseCreditRoutes,
      ...relationshipPayload,
      similarResearchEntities,
    },
    // The names this route already resolved. Every list surface passes its own through
    // `leadMemberNamesByEntityId`; the detail page computed them and then built its DTO
    // without them, so the serve chain ran the whole name-identity layer on an empty
    // lead set. That switched off the #2913 key-names-only-this-person arm for the one
    // surface a student lands on: 8 served rows titled themselves with an organization
    // their lead merely directs (#3132, the #2240 browse-versus-detail shape).
    { leadMemberNames },
  );
}
