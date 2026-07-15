/**
 * Service layer for canonical ResearchEntity browse/detail plus the
 * find-or-create helper that gives every Listing a parent entity on creation.
 *
 * Strategy for findOrCreateForOwner:
 *   1. Look for an existing group where the owner is a 'pi' member.
 *   2. If none, derive a slug from the owner (surname + 'lab' or 'individual').
 *   3. Upsert by slug; create the ResearchGroupMember row with role='pi'.
 *   4. Return the group _id.
 *
 * The created group is `kind: 'individual'` for fields that don't traditionally have
 * "labs" (Econ, History, etc.); otherwise `kind: 'lab'`. This is determined by the
 * primary department's category.
 */
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { Department, DepartmentCategory } from '../models/department';
import { Paper } from '../models/paper';
import { Listing } from '../models/listing';
import { User } from '../models/user';
import { FacultyMember } from '../models/facultyMember';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { StudentTracking } from '../models/studentTracking';
import { StudentOutreach } from '../models/studentOutreach';
import { getMeiliIndex } from '../utils/meiliClient';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  getAccessSummaryForResearchEntity,
  listAccessSummariesForResearchEntities,
} from './accessSummaryService';
import { buildResearchGroupFilterString, ResearchGroupFilterInput } from './researchGroupFilters';
import {
  buildResearchEntityQualitySummary,
  type ResearchEntityQualitySummary,
} from './researchEntityQuality';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  toPublicResearchEntitySummaryDto,
  type PublicResearchEntityDto,
  type PublicResearchEntitySummaryDto,
} from './researchEntityDto';
import {
  isPublicResearchPaperLink,
  paperToScholarlyLink,
  scholarlyLinkToPublicLink,
} from './profileService';
import {
  isLikelyPublicProfileImageUrl,
  isSharedProfileImageAcrossDifferentNames,
} from '../scripts/profileImageQualityAuditCore';
import {
  sanitizeResearchEntityPublicDescriptionFields,
  sanitizeFacultyResearchEntityCopyFields,
  sanitizeFacultyResearchEntityText,
} from '../utils/researchEntityDescriptionText';
import { publicStudentDecisionExplanation } from './studentDecisionExplanationService';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { studentPathwayMongoMatch } from './studentAccessPublicationPolicy';
import { isApprovedPublicContactRoute } from './studentAccessPublicationPolicy';
import {
  canonicalScholarlyWorkKey,
  evaluateResearchActivityIntegrity,
  type ResearchActivityCandidate,
} from './researchActivityIntegrity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { listPlanningContextsForResearchEntities } from './planningContextService';

const optionalPlanningContexts = async (entityIds: any[]) => {
  try {
    return await listPlanningContextsForResearchEntities(entityIds);
  } catch (error) {
    console.error('Optional research planning-context enrichment failed:', sanitizeLogValue(error));
    return new Map();
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
    if (fname && surname) return `${fname} ${surname} — Research`;
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

  const ownerObjectId = normalizeResearchGroupObjectId(owner._id);
  if (ownerObjectId) {
    const existingMember = await ResearchGroupMember.findOne({
      userId: ownerObjectId,
      role: 'pi',
    }).lean();
    if (existingMember) {
      const existingResearchEntityId = normalizeResearchGroupObjectId(
        (existingMember as any).researchEntityId || (existingMember as any).researchGroupId,
      );
      if (existingResearchEntityId) {
        const group = await ResearchEntity.findById(existingResearchEntityId).lean();
        if (group) return { group, created: false };
      }
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
      openness: 'open',
      acceptingUndergrads: true,
      lastObservedAt: new Date(),
      sourceUrls: [],
      departments: owner.primaryDepartment ? [owner.primaryDepartment] : [],
    },
  };

  const group: any = await ResearchEntity.findOneAndUpdate({ slug }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  }).lean();

  if (ownerObjectId) {
    await ResearchGroupMember.updateOne(
      { researchEntityId: group._id, userId: ownerObjectId },
      {
        $setOnInsert: {
          researchEntityId: group._id,
          researchGroupId: group._id,
          userId: ownerObjectId,
          role: 'pi',
          startedAt: new Date(),
          lastObservedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  const created = !group.updatedAt || group.createdAt?.getTime?.() === group.updatedAt?.getTime?.();
  return { group, created };
}

export async function getResearchGroupById(id: any): Promise<any | null> {
  const safeId = normalizeResearchGroupObjectId(id);
  if (!safeId) return null;
  return ResearchEntity.findById(safeId).lean();
}

export async function getResearchGroupBySlug(slug: string): Promise<any | null> {
  return ResearchEntity.findOne({
    slug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();
}

export async function listMembersOfGroup(groupId: any): Promise<any[]> {
  const safeGroupId = normalizeResearchGroupObjectId(groupId);
  if (!safeGroupId) return [];
  return ResearchGroupMember.find({ researchEntityId: safeGroupId }).lean();
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
const MAX_PAGE = 1000;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_FILTER_VALUES = 50;
const MAX_FILTER_VALUE_LENGTH = 120;
const STUDENT_QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
  'prof',
  'professor',
  'lab',
  'labs',
  'laboratory',
  'research',
]);

const STUDENT_QUERY_ALIASES: Record<string, string[]> = {
  ai: ['artificial intelligence', 'machine learning', 'deep learning', 'ai'],
  ml: ['machine learning', 'artificial intelligence', 'deep learning', 'ml'],
  nlp: ['natural language processing', 'computational linguistics', 'nlp'],
  cv: ['computer vision', 'image analysis', 'visual recognition', 'cv'],
  neuro: ['neuroscience', 'neurology', 'neural', 'brain', 'neuro'],
  psych: ['psychology', 'psychiatry', 'cognitive science', 'behavioral science', 'psych'],
};

const SHORT_ALIAS_QUERY_ATTRIBUTES = [
  'studentSearchTerms',
  'researchAreas',
  'keywords',
  'departments',
];

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
  isShortAliasQuery: boolean;
}

export const normalizeResearchSearchQuery = (value: unknown): NormalizedResearchSearchQuery => {
  const raw = boundedResearchSearchQuery(value);
  const tokens = tokenizeStudentResearchQuery(raw);
  const meaningfulTokens = tokens.filter((token) => !STUDENT_QUERY_STOP_WORDS.has(token));
  const queryTokens = meaningfulTokens.length > 0 ? meaningfulTokens : tokens;
  const expandedTerms = queryTokens.flatMap((token) => STUDENT_QUERY_ALIASES[token] || [token]);
  const normalizedTerms = uniqueQueryTerms(expandedTerms);
  const isShortAliasQuery =
    queryTokens.length === 1 &&
    queryTokens[0].length <= 3 &&
    Object.prototype.hasOwnProperty.call(STUDENT_QUERY_ALIASES, queryTokens[0]);

  return {
    raw,
    query: normalizedTerms.join(' ').slice(0, MAX_SEARCH_QUERY_LENGTH),
    tokens: queryTokens,
    isShortAliasQuery,
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

const isAcceptanceLevelInput = (
  value: unknown,
): value is NonNullable<ResearchGroupFilterInput['acceptanceLevel']> =>
  value === 'verified' || value === 'verified-or-likely' || value === 'all';

const isResearchGroupQualityFilter = (value: unknown): value is ResearchGroupQualityFilter =>
  value === 'description-issue' || value === 'missing-lead' || value === 'profile-fallback';

const sanitizeResearchGroupSearchFilters = (
  filters: ResearchGroupFilterInput = {},
): ResearchGroupFilterInput => ({
  kind: boundedResearchFilterValues(filters.kind),
  school: boundedResearchFilterValues(filters.school),
  departments: boundedResearchFilterValues(filters.departments),
  researchAreas: boundedResearchFilterValues(filters.researchAreas),
  openness: boundedResearchFilterValues(filters.openness),
  acceptingUndergrads:
    typeof filters.acceptingUndergrads === 'boolean' ? filters.acceptingUndergrads : undefined,
  acceptanceLevel: isAcceptanceLevelInput(filters.acceptanceLevel)
    ? filters.acceptanceLevel
    : undefined,
  studentVisibilityTier: boundedResearchFilterValues(filters.studentVisibilityTier),
});

const sanitizeResearchGroupSearchOptions = (
  options: ResearchGroupSearchOptions = {},
): ResearchGroupSearchOptions => ({
  includeNonPublic: options.includeNonPublic === true,
  lowQualityFirst: options.lowQualityFirst === true,
  qualityFilters: boundedResearchFilterValues(
    options.qualityFilters as string[] | undefined,
  ).filter(isResearchGroupQualityFilter),
});

const mongoVisibilityFilter = (
  filters: ResearchGroupFilterInput,
  includeNonPublic?: boolean,
): Record<string, any> => {
  if (filters.studentVisibilityTier?.length) {
    return { studentVisibilityTier: { $in: filters.studentVisibilityTier } };
  }
  return includeNonPublic ? {} : { studentVisibilityTier: { $in: publicStudentVisibilityTiers } };
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
  if (filters.school?.length) mongoFilter.school = { $in: filters.school };
  if (filters.departments?.length) mongoFilter.departments = { $in: filters.departments };
  if (filters.researchAreas?.length) mongoFilter.researchAreas = { $in: filters.researchAreas };
  if (filters.openness?.length) mongoFilter.openness = { $in: filters.openness };
  if (typeof filters.acceptingUndergrads === 'boolean') {
    mongoFilter.acceptingUndergrads = filters.acceptingUndergrads;
  }
  if (filters.acceptanceLevel === 'verified') {
    mongoFilter.acceptingUndergrads = true;
    mongoFilter.acceptanceConfidence = { $gte: 0.7 };
  } else if (filters.acceptanceLevel === 'verified-or-likely') {
    mongoFilter.$or = [
      { acceptingUndergrads: true },
      { offersIndependentStudy: true },
      { currentUndergradCount: { $gt: 0 } },
    ];
  }

  return mongoFilter;
};

const leadMembersForEntities = async (entityIds: any[]): Promise<Map<string, any[]>> => {
  if (entityIds.length === 0) return new Map();
  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: { $in: ['pi', 'principal_investigator', 'lead', 'faculty_lead'] },
  }).lean();
  const byEntityId = new Map<string, any[]>();
  for (const member of members as any[]) {
    const key = researchGroupDocumentId(member.researchEntityId || member.researchGroupId);
    if (!key) continue;
    byEntityId.set(key, [...(byEntityId.get(key) || []), member]);
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
 * Hybrid Meilisearch query for ResearchEntity. Mirrors the pattern used in
 * listingService — keyword-only when no query, hybrid (semanticRatio 0.8) when
 * a non-empty query is provided.
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
  const safePage = Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const offset = (safePage - 1) * safePageSize;

  const filterString = buildResearchGroupFilterString(safeFilters);

  const normalizedQuery = normalizeResearchSearchQuery(query);
  const trimmedQuery = normalizedQuery.query;
  if (trimmedQuery === '' && safeOptions.lowQualityFirst) {
    const candidates = await ResearchEntity.find(
      mongoFilterFromResearchFilters(safeFilters, safeOptions.includeNonPublic),
    ).lean();
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
    const activeListingGroupIds =
      pageEntityIds.length > 0
        ? await Listing.distinct('researchEntityId', {
            researchEntityId: { $in: pageEntityIds },
            archived: false,
          })
        : [];
    const activeListingGroupIdSet = new Set(
      activeListingGroupIds.map((id: any) => researchGroupDocumentId(id)).filter(Boolean),
    );
    const [accessSummaries, planningContexts] = await Promise.all([
      listAccessSummariesForResearchEntities(pageEntityIds),
      optionalPlanningContexts(pageEntityIds),
    ]);
    return addResearchEntitySearchAliases(
      {
        hits: pageEntities.map((entity) => ({
          ...entity,
          _id: researchGroupDocumentId(entity._id),
          hasActiveListing: activeListingGroupIdSet.has(researchGroupDocumentId(entity._id)),
          accessSummary: accessSummaries.get(researchGroupDocumentId(entity._id)),
          planningContext: planningContexts.get(researchGroupDocumentId(entity._id)),
        })),
        estimatedTotalHits: filteredCandidates.length,
        page: safePage,
        pageSize: safePageSize,
      },
      { includeOperatorFields: safeOptions.includeNonPublic },
    );
  }

  const sortConfig: string[] = [];
  if (sort.sortBy) {
    const order = sort.sortOrder === 'asc' ? 'asc' : 'desc';
    sortConfig.push(`${sort.sortBy}:${order}`);
  } else if (trimmedQuery === '') {
    // Default browse: surface the "best" research homes first — those with the
    // strongest completeness + undergrad-access signal — then fall back to
    // recency as a tiebreak. See services/researchEntityBrowseRank.ts.
    sortConfig.push('browseRankScore:desc');
    sortConfig.push('lastObservedAt:desc');
  }

  const searchParams: Record<string, any> = {
    filter: filterString,
    limit: safePageSize,
    offset,
    facets: ['school', 'departments'],
  };
  if (sortConfig.length > 0) {
    searchParams.sort = sortConfig;
  }
  if (trimmedQuery !== '') {
    searchParams.hybrid = {
      semanticRatio: 0.8,
      embedder: 'default',
    };
    if (normalizedQuery.isShortAliasQuery) {
      searchParams.attributesToSearchOn = SHORT_ALIAS_QUERY_ATTRIBUTES;
      delete searchParams.hybrid;
    }
  }

  const index = await getMeiliIndex('researchentities');
  // Search, degrading gracefully on recoverable errors: drop the semantic
  // embedder if it is not configured, and drop the browseRankScore sort key if
  // the running index has not yet had it added to sortableAttributes. Each
  // degradation is applied at most once; anything else propagates.
  const searchWithFallbacks = async (): Promise<{
    hits?: any[];
    estimatedTotalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  }> => {
    // Each attempt uses an immutable params object; degrading clones rather than
    // mutating, so already-issued calls keep the params they were sent.
    let params: Record<string, any> = searchParams;
    while (true) {
      try {
        return await index.search(trimmedQuery, params);
      } catch (error) {
        if (params.hybrid && isMissingMeiliEmbedderError(error)) {
          params = { ...params };
          delete params.hybrid;
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
            continue;
          }
        }
        throw error;
      }
    }
  };
  let searchResult: {
    hits?: any[];
    estimatedTotalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  };
  try {
    searchResult = await searchWithFallbacks();
  } catch (error) {
    console.error('ResearchEntity Meilisearch failed; falling back to Mongo search:', error);
    return searchResearchGroupsViaMongoFallback(
      normalizedQuery.raw,
      safeFilters,
      safePage,
      safePageSize,
      sort,
      safeOptions,
    );
  }
  const { hits, estimatedTotalHits, facetDistribution } = searchResult;

  const hitIds = (hits || [])
    .map((hit: any) => hit.id || hit._id)
    .map(normalizeResearchGroupObjectId)
    .filter((id): id is string => Boolean(id));
  const visibleEntities =
    hitIds.length > 0
      ? await ResearchEntity.find({
          _id: { $in: hitIds },
          archived: { $ne: true },
          ...mongoVisibilityFilter(safeFilters, safeOptions.includeNonPublic),
        }).lean()
      : [];
  const visibleEntitiesById = new Map(
    (visibleEntities as any[]).map((entity) => [researchGroupDocumentId(entity._id), entity]),
  );
  const visibleHitIds = hitIds.filter((id: any) =>
    visibleEntitiesById.has(researchGroupDocumentId(id)),
  );
  const activeListingGroupIds =
    visibleHitIds.length > 0
      ? await Listing.distinct('researchEntityId', {
          researchEntityId: { $in: visibleHitIds },
          archived: false,
        })
      : [];
  const activeListingGroupIdSet = new Set(
    activeListingGroupIds.map((id: any) => researchGroupDocumentId(id)).filter(Boolean),
  );

  // Map Meilisearch's `id` back to `_id` for client backward compatibility.
  const [accessSummaries, planningContexts] = await Promise.all([
    listAccessSummariesForResearchEntities(visibleHitIds),
    optionalPlanningContexts(visibleHitIds),
  ]);
  const normalizedHits = (hits || []).flatMap((hit: any) => {
    const id = hit.id || hit._id;
    const entityId = researchGroupDocumentId(id);
    const entity = visibleEntitiesById.get(entityId);
    if (!entity) return [];
    return {
      ...entity,
      _id: id,
      hasActiveListing: activeListingGroupIdSet.has(entityId),
      accessSummary: accessSummaries.get(entityId),
      planningContext: planningContexts.get(entityId),
      ...(hit.searchMatch ? { searchMatch: hit.searchMatch } : {}),
    };
  });

  return addResearchEntitySearchAliases(
    {
      hits: normalizedHits,
      estimatedTotalHits: estimatedTotalHits ?? normalizedHits.length,
      page: safePage,
      pageSize: safePageSize,
      facetDistribution,
    },
    { includeOperatorFields: safeOptions.includeNonPublic },
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
    entity.description,
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
  if (!normalizedQuery.query) return true;
  if (normalizedQuery.tokens.length === 0) return true;
  const haystack = researchEntitySearchText(entity);
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
  const safePage = Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const offset = (safePage - 1) * safePageSize;
  const trimmedQuery = boundedResearchSearchQuery(query);
  const candidates = await ResearchEntity.find(
    mongoFilterFromResearchFilters(filters, options.includeNonPublic),
  ).lean();
  const visibleCandidates = (candidates as any[]).filter((entity) =>
    researchEntityMatchesQuery(entity, trimmedQuery),
  );
  const facetDistribution = {
    school: facetCounts(visibleCandidates, 'school'),
    departments: facetCounts(visibleCandidates, 'departments'),
  };
  const sortedCandidates = sortResearchEntitiesForMongoFallback(
    visibleCandidates,
    trimmedQuery,
    sort,
  );
  const pageEntities = sortedCandidates.slice(offset, offset + safePageSize);
  const pageEntityIds = pageEntities.map((entity) => entity._id);
  const activeListingGroupIds =
    pageEntityIds.length > 0
      ? await Listing.distinct('researchEntityId', {
          researchEntityId: { $in: pageEntityIds },
          archived: false,
        })
      : [];
  const activeListingGroupIdSet = new Set(
    activeListingGroupIds.map((id: any) => researchGroupDocumentId(id)).filter(Boolean),
  );
  const accessSummaries = await listAccessSummariesForResearchEntities(pageEntityIds);

  return addResearchEntitySearchAliases(
    {
      hits: pageEntities.map((entity) => ({
        ...entity,
        _id: researchGroupDocumentId(entity._id),
        hasActiveListing: activeListingGroupIdSet.has(researchGroupDocumentId(entity._id)),
        accessSummary: accessSummaries.get(researchGroupDocumentId(entity._id)),
      })),
      estimatedTotalHits: sortedCandidates.length,
      page: safePage,
      pageSize: safePageSize,
      facetDistribution,
      degraded: true,
    },
    { includeOperatorFields: options.includeNonPublic },
  ) as ResearchGroupSearchResult;
};

const PUBLIC_USER_FIELDS =
  'netid email fname lname imageUrl primaryDepartment title secondaryDepartments facultyMemberId profileUrls website websiteUrl';

const PUBLIC_PROFILE_ROUTE_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
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

const GENERIC_PERSON_DIRECTORY_SEGMENTS = new Set([
  'directory',
  'directories',
  'faculty',
  'faculty-directory',
  'members',
  'people',
  'person',
  'profiles',
  'staff',
]);
const GENERIC_PROFILE_CATEGORY_SEGMENTS = new Set([
  'active',
  'adjunct',
  'affiliated',
  'affiliate',
  'all',
  'clinical',
  'emeriti',
  'emeritus',
  'instructional',
  'ladder',
  'postdoctoral',
  'postdocs',
  'primary',
  'research',
  'secondary',
  'visiting',
]);

const hasSpecificOfficialPersonPathSegment = (pathSegments: string[], label: string): boolean => {
  const index = pathSegments.indexOf(label);
  if (index < 0) return false;
  const nextSegment = pathSegments[index + 1] || '';
  return (
    Boolean(nextSegment) &&
    !GENERIC_PERSON_DIRECTORY_SEGMENTS.has(nextSegment) &&
    !GENERIC_PROFILE_CATEGORY_SEGMENTS.has(nextSegment)
  );
};

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

const publicInternalProfilePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return PUBLIC_PROFILE_ROUTE_ID_RE.test(trimmed)
    ? `/profile/${encodeURIComponent(trimmed)}`
    : undefined;
};

const publicInternalProfilePathFromPath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = /^\/profile\/([^/?#]+)$/.exec(value.trim());
  if (!match) return undefined;
  try {
    return publicInternalProfilePath(decodeURIComponent(match[1]));
  } catch {
    return undefined;
  }
};

const addPublicMemberInternalProfilePath = (target: Record<string, any>, value: unknown) => {
  const path = publicInternalProfilePath(value);
  if (path) {
    target.internalProfilePath = path;
    target.internal_profile_path = path;
  }
};

const hasPublicMemberProfileUrls = (value: Record<string, any>): boolean =>
  Boolean(value.profileUrls && Object.keys(value.profileUrls).length > 0);

function publicMemberUserFromFaculty(faculty: any): any | null {
  if (!faculty) return null;
  const [fallbackFirstName = '', ...rest] = String(faculty.name || '')
    .trim()
    .split(/\s+/);
  const fallbackLastName = rest.join(' ');
  const publicUser: Record<string, any> = {
    _id: faculty.userId || faculty._id,
    fname: faculty.firstName || fallbackFirstName,
    lname: faculty.lastName || fallbackLastName,
    imageUrl: faculty.photoUrl,
    image_url: faculty.photoUrl,
    primaryDepartment: faculty.primarySchool || '',
    primary_department: faculty.primarySchool || '',
    title: faculty.title || faculty.bio || '',
    websiteUrl: publicOfficialYalePersonProfileUrl(faculty.websiteUrl) || '',
  };
  addPublicMemberProfileUrls(publicUser, faculty.profileUrls);
  if (!hasPublicMemberProfileUrls(publicUser) && !publicUser.websiteUrl) {
    addPublicMemberInternalProfilePath(publicUser, faculty.netid);
  }
  return publicUser;
}

const addPublicMemberField = (target: Record<string, any>, key: string, value: any) => {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
};

function publicMemberKeyForResearchDetail(user: any, role?: string): string {
  return [user?.displayName || [user?.fname, user?.lname].filter(Boolean).join(' '), role]
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

  addPublicMemberField(publicUser, 'fname', user?.fname);
  addPublicMemberField(publicUser, 'lname', user?.lname);
  addPublicMemberField(publicUser, 'displayName', user?.displayName);
  addPublicMemberField(publicUser, 'title', user?.title);
  publicUser.imageUrl = imageUrl;
  publicUser.image_url = imageUrl;
  addPublicMemberField(publicUser, 'primaryDepartment', primaryDepartment);
  addPublicMemberField(publicUser, 'primary_department', primaryDepartment);
  addPublicMemberProfileUrls(publicUser, user?.profileUrls || user?.profile_urls);
  if (!hasPublicMemberProfileUrls(publicUser)) {
    const internalProfilePath =
      publicInternalProfilePathFromPath(user?.internalProfilePath || user?.internal_profile_path) ||
      publicInternalProfilePath(user?.netid);
    if (internalProfilePath) {
      publicUser.internalProfilePath = internalProfilePath;
      publicUser.internal_profile_path = internalProfilePath;
    } else {
      const website = publicHttpUrl(user?.websiteUrl) || publicHttpUrl(user?.website);
      if (website) {
        publicUser.website = website;
        publicUser.websiteUrl = website;
      }
    }
  }

  return publicUser;
}

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

  const sameImageUsers = await User.find({ imageUrl: { $in: imageUrls } })
    .select('_id netid fname lname email imageUrl')
    .limit(500)
    .lean();

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

export function publicMemberUserForRow(
  row: any,
  usersById: Map<string, any>,
  facultyMembersById: Map<string, any>,
): any | null {
  const user = row.userId ? usersById.get(researchGroupDocumentId(row.userId)) || null : null;
  const faculty = row.facultyMemberId
    ? facultyMembersById.get(researchGroupDocumentId(row.facultyMemberId)) || null
    : null;
  const userFacultyId = user?.facultyMemberId ? researchGroupDocumentId(user.facultyMemberId) : '';
  const rowFacultyId = row.facultyMemberId ? researchGroupDocumentId(row.facultyMemberId) : '';

  if (faculty && (!user || (userFacultyId && userFacultyId !== rowFacultyId))) {
    return publicMemberUserFromFaculty(faculty);
  }

  return publicMemberUserForResearchDetail(user);
}

const PUBLIC_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

export const currentResearchEntityMemberFilter = (researchEntityId: unknown) => ({
  researchEntityId,
  archived: { $ne: true },
  isCurrentMember: { $ne: false },
});

const MAX_PUBLIC_DETAIL_MEMBERS = 100;
const MAX_PUBLIC_DETAIL_LISTINGS = 50;
const MAX_PUBLIC_DETAIL_ENTRY_PATHWAYS = 50;
const MAX_PUBLIC_DETAIL_ACCESS_SIGNALS = 50;
const MAX_PUBLIC_DETAIL_CONTACT_ROUTES = 50;
const MAX_PUBLIC_DETAIL_POSTED_OPPORTUNITIES = 50;
const MAX_PUBLIC_DETAIL_RELATIONSHIPS_PER_DIRECTION = 50;
const MAX_PUBLIC_DETAIL_RELATIONSHIP_QUERY_LIMIT = 51;
const PUBLIC_RELATED_ENTITY_PROJECTION =
  '_id slug name displayName kind entityType departments shortDescription description fullDescription studentVisibilityTier';

export interface PublicRelationshipCollectionMeta {
  returned: number;
  truncated: boolean;
}

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
  const publicRelatedEntities = (relatedEntities as any[]).filter((entity) =>
    publicStudentVisibilityTiers.includes(entity.studentVisibilityTier),
  );

  const publicEntitiesByInternalId = new Map(
    publicRelatedEntities.map((entity) => [
      researchGroupDocumentId(entity._id),
      toPublicResearchEntitySummaryDto(sanitizeResearchEntityPublicDescriptionFields(entity)),
    ]),
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
    relatedResearchEntities: relatedEntityIds
      .map((id) => publicEntitiesByInternalId.get(researchGroupDocumentId(id)))
      .filter((entity): entity is PublicResearchEntitySummaryDto => Boolean(entity)),
    relatedResearchEntitiesMeta: {
      returned: relatedEntityIds.filter((id) =>
        publicEntitiesByInternalId.has(researchGroupDocumentId(id)),
      ).length,
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
    affiliatedResearchEntities: affiliatedEntityIds
      .map((id) => publicEntitiesByInternalId.get(researchGroupDocumentId(id)))
      .filter((entity): entity is PublicResearchEntitySummaryDto => Boolean(entity)),
    affiliatedResearchEntitiesMeta: {
      returned: affiliatedEntityIds.filter((id) =>
        publicEntitiesByInternalId.has(researchGroupDocumentId(id)),
      ).length,
      truncated: affiliatedRelationshipsAll.length > affiliatedRelationships.length,
    },
  };
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

const OFFICIAL_PROFILE_URL_KEYS = [
  'official',
  'medicine',
  'ysm',
  'departmental',
  'directory',
  'yalies',
];

const safeProfileUrlObject = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, url]) => publicHttpUrl(url)),
  ) as Record<string, string>;
};

const isLikelyOfficialPersonProfileUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();

  try {
    if (!isPublicHttpUrl(trimmed)) return false;
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathSegments = parsed.pathname
      .toLowerCase()
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const isYaleOwned = host === 'yale.edu' || host.endsWith('.yale.edu') || host === 'yalies.io';
    if (!isYaleOwned) return false;
    if (host === 'yalies.io') return true;

    return (
      hasSpecificOfficialPersonPathSegment(pathSegments, 'profile') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'profiles') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'people') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'person') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'faculty') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'faculty-directory')
    );
  } catch {
    return false;
  }
};

const resolveLeadOfficialProfileUrl = (lead: { user?: any; row?: any }): string => {
  const profileUrls = safeProfileUrlObject(lead.user?.profileUrls || lead.user?.profile_urls);
  const orderedKeys = [
    ...OFFICIAL_PROFILE_URL_KEYS,
    ...Object.keys(profileUrls).filter((key) => !OFFICIAL_PROFILE_URL_KEYS.includes(key)),
  ];

  for (const key of orderedKeys) {
    const url = profileUrls[key];
    if (isLikelyOfficialPersonProfileUrl(url)) return url.trim();
  }

  const fallbackUrls = [lead.user?.websiteUrl, lead.user?.website, lead.row?.sourceUrl];
  return fallbackUrls.find(isLikelyOfficialPersonProfileUrl)?.trim() || '';
};

const normalizePublicUrlDestination = (url?: string | null): string => {
  const value = String(url || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return value
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
};

function isResearchWebsiteFacultyPiRoute(route: any, group: any): boolean {
  if (route?.routeType !== 'FACULTY_PI') return false;
  const researchWebsiteDestinations = new Set(
    [group?.websiteUrl, group?.website]
      .filter((url) => url && !isLikelyOfficialPersonProfileUrl(url))
      .map(normalizePublicUrlDestination)
      .filter(Boolean),
  );
  if (researchWebsiteDestinations.size === 0) return false;
  return [route.url, route.sourceUrl]
    .map(normalizePublicUrlDestination)
    .some((destination) => destination && researchWebsiteDestinations.has(destination));
}

function contactRouteDedupeKey(route: any): string {
  const routeType = String(route?.routeType || 'UNKNOWN')
    .trim()
    .toUpperCase();
  const destination =
    normalizePublicUrlDestination(route?.url) ||
    normalizePublicUrlDestination(route?.sourceUrl) ||
    String(route?.email || '')
      .trim()
      .toLowerCase() ||
    String(route?.label || route?.name || '')
      .trim()
      .toLowerCase();
  return `${routeType}:${destination}`;
}

function contactRouteRank(route: any): number {
  let rank = 0;
  if (researchGroupDocumentId(route?._id).startsWith('derived-pi-outreach-')) rank -= 20;
  if (String(route?.email || '').trim()) rank -= 10;
  if (normalizePublicUrlDestination(route?.url)) rank -= 5;
  rank += Number.isFinite(route?.priority) ? route.priority : 100;
  return rank;
}

function dedupePublicContactRoutes(routes: any[]): any[] {
  const deduped = new Map<string, any>();

  for (const [index, route] of routes.entries()) {
    const key = contactRouteDedupeKey(route);
    if (!key.split(':')[1]) {
      const fallbackKey = researchGroupDocumentId(route?._id) || `route-${index}`;
      deduped.set(fallbackKey, route);
      continue;
    }

    const existing = deduped.get(key);
    if (!existing || contactRouteRank(route) < contactRouteRank(existing)) {
      deduped.set(key, route);
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) =>
      (Number.isFinite(a?.priority) ? a.priority : 100) -
        (Number.isFinite(b?.priority) ? b.priority : 100) ||
      researchGroupDocumentId(a?._id).localeCompare(researchGroupDocumentId(b?._id)),
  );
}

const publicContactRouteForResearchDetail = (route: any) => ({
  routeType: route.routeType,
  label: publicString(route.label),
  name: publicString(route.name),
  role: publicString(route.role),
  priority: route.priority,
  visibility: route.visibility,
  contactPolicy: route.contactPolicy,
  rationale: publicString(route.rationale),
  url: publicHttpUrl(route.url),
  sourceUrl: publicHttpUrl(route.sourceUrl),
  observedAt: route.observedAt,
  reviewStatus: route.review?.status,
});

export function buildLeadPiOutreachContactRoute(
  members: Array<{ user: any; role: string; row?: any }>,
  group: any,
): any | null {
  const lead = members
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .find((member) => resolveLeadOfficialProfileUrl(member));
  if (!lead) return null;

  const name = memberDisplayName(lead);
  const officialProfileUrl = resolveLeadOfficialProfileUrl(lead);
  if (!officialProfileUrl) return null;

  const key = (researchGroupDocumentId(lead.user?._id) || name || officialProfileUrl)
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, '-');
  const route = {
    _id: `derived-pi-outreach-${key}`,
    routeType: 'FACULTY_PI',
    label: name || 'Lead professor',
    name: name || undefined,
    role:
      lead.role === 'director' || lead.role === 'co-director'
        ? 'Director'
        : 'Principal Investigator',
    priority: 80,
    visibility: 'PUBLIC',
    contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
    rationale: 'Derived from the attached lead PI official profile.',
    sourceUrl: publicHttpUrl(officialProfileUrl || lead.row?.sourceUrl || group?.websiteUrl) || '',
  } as any;

  if (officialProfileUrl) route.url = officialProfileUrl;
  return route;
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

export function buildResearchActivityLinkPayload({
  researchEntityId,
  entityTopicEvidence = [],
  entityLinkedPapers = [],
  memberPaperPairs = [],
  entityScholarlyLinks = [],
  memberScholarlyLinkPairs = [],
}: {
  researchEntityId: unknown;
  entityTopicEvidence?: unknown;
  entityLinkedPapers?: Array<Record<string, any>>;
  memberPaperPairs?: Array<{ paper: Record<string, any>; memberDisplayId?: unknown }>;
  entityScholarlyLinks?: Array<Record<string, any>>;
  memberScholarlyLinkPairs?: Array<{
    link: Record<string, any>;
    memberDisplayId?: unknown;
    relationshipBasis?: string;
    evidenceLabel?: string;
    confidence?: number;
    observedAt?: unknown;
    sourceName?: string;
    sourceUrl?: string;
    appointmentStartedAt?: unknown;
    appointmentEndedAt?: unknown;
  }>;
}) {
  const seen = new Set<string>();
  const seenCanonicalWorks = new Set<string>();
  const uniqueKey = (basis: string, id: unknown, owner?: unknown) =>
    [basis, researchGroupDocumentId(id), researchGroupDocumentId(owner)].join(':');

  const withoutInternalResearchActivityIds = (link: Record<string, any>) => {
    const { researchEntityId: _researchEntityId, userId: _userId, ...publicLink } = link;
    return publicLink;
  };

  const scholarlyLinks = [
    ...entityScholarlyLinks.map((link) =>
      withoutInternalResearchActivityIds(
        scholarlyLinkToPublicLink(link, {
          researchEntityId,
          relationshipBasis: 'explicit_entity_link',
          evidenceLabel: 'Linked to this research profile',
        }),
      ),
    ),
    ...entityLinkedPapers.map((paper) => ({
      ...paperToScholarlyLink(paper),
      relationshipBasis: 'explicit_entity_link',
      evidenceLabel: 'Linked to this research profile',
    })),
  ].filter((link) => {
    const key = uniqueKey(link.relationshipBasis || '', link._id);
    const canonicalKey = canonicalScholarlyWorkKey(link);
    if (seen.has(key) || seenCanonicalWorks.has(canonicalKey) || !isPublicResearchPaperLink(link))
      return false;
    seen.add(key);
    seenCanonicalWorks.add(canonicalKey);
    return true;
  });

  const integrityDecisions = evaluateResearchActivityIntegrity(
    memberScholarlyLinkPairs.filter((pair) => pair.memberDisplayId) as ResearchActivityCandidate[],
    entityTopicEvidence,
  );
  const publicMemberLink = (pair: ResearchActivityCandidate, earlier = false) => ({
    ...withoutInternalResearchActivityIds(
      scholarlyLinkToPublicLink(pair.link, {
        relationshipBasis: pair.relationshipBasis || 'identity_authorship',
        evidenceLabel: earlier
          ? 'Earlier work by a listed professor, before the documented current appointment'
          : pair.evidenceLabel || 'Authored by a verified Yale faculty identity',
        confidence: pair.confidence,
        observedAt: pair.observedAt,
        sourceName: pair.sourceName,
        sourceUrl: pair.sourceUrl,
      }),
    ),
    memberKey: pair.memberDisplayId,
  });

  const memberScholarlyLinks = [
    ...integrityDecisions
      .filter((decision) => decision.disposition === 'current')
      .map((pair) => publicMemberLink(pair.candidate)),
    ...memberPaperPairs
      .filter((pair) => pair.memberDisplayId)
      .map((pair) => ({
        ...paperToScholarlyLink(pair.paper),
        memberKey: pair.memberDisplayId,
        relationshipBasis: 'member_authorship',
        evidenceLabel: 'Authored by a listed professor',
      })),
  ].filter((link: any) => {
    const key = uniqueKey(link.relationshipBasis || '', link._id, link.memberKey);
    const canonicalKey = canonicalScholarlyWorkKey(link);
    if (seen.has(key) || seenCanonicalWorks.has(canonicalKey) || !isPublicResearchPaperLink(link))
      return false;
    seen.add(key);
    seenCanonicalWorks.add(canonicalKey);
    return true;
  });

  const earlierMemberScholarlyLinks = integrityDecisions
    .filter((decision) => decision.disposition === 'earlier')
    .map((decision) => publicMemberLink(decision.candidate, true))
    .filter((link) => {
      const canonicalKey = canonicalScholarlyWorkKey(link);
      if (seenCanonicalWorks.has(canonicalKey) || !isPublicResearchPaperLink(link)) return false;
      seenCanonicalWorks.add(canonicalKey);
      return true;
    });

  return {
    scholarlyLinks,
    memberScholarlyLinks,
    researchActivityLinks: [...scholarlyLinks, ...memberScholarlyLinks],
    earlierResearchActivityLinks: earlierMemberScholarlyLinks,
  };
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

const publicHttpUrls = (values: unknown): string[] =>
  Array.isArray(values) ? values.flatMap((value) => publicHttpUrl(value) ?? []) : [];

const MAX_PUBLIC_DETAIL_TEXT_LENGTH = 5000;
const MAX_PUBLIC_DETAIL_ARRAY_ITEMS = 100;

const publicString = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? redactDirectContactInfo(value.slice(0, MAX_PUBLIC_DETAIL_TEXT_LENGTH))
    : undefined;

const publicStringArray = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.slice(0, MAX_PUBLIC_DETAIL_ARRAY_ITEMS).flatMap((value) => publicString(value) ?? [])
    : [];

const publicPaperDate = (value: unknown): string | undefined => {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
};

const publicPaperNumber = (value: unknown, min = 0, max = 1_000_000): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return number;
};

const PUBLIC_PAPER_STAGES = new Set(['PREPRINT', 'PUBLISHED', 'UNKNOWN']);

const publicPaperKeyForResearchDetail = (paper: any): string => {
  const stableSource =
    publicString(paper?.arxivId) ||
    publicString(paper?.doi) ||
    publicString(paper?.title) ||
    'paper';
  const year = publicPaperNumber(paper?.year, 1000, 3000);
  return [stableSource, year]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
};

const addPublicPaperField = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
};

const publicPaperForResearchDetail = (paper: any) => {
  const publicationStage = publicString(paper?.publicationStage);
  const publicPaper: Record<string, unknown> = {
    _id: publicPaperKeyForResearchDetail(paper),
    title: publicString(paper?.title) || 'Untitled research activity',
  };

  addPublicPaperField(publicPaper, 'authors', publicStringArray(paper?.authors));
  addPublicPaperField(publicPaper, 'year', publicPaperNumber(paper?.year, 1000, 3000));
  addPublicPaperField(publicPaper, 'venue', publicString(paper?.venue));
  addPublicPaperField(publicPaper, 'abstract', publicString(paper?.abstract));
  addPublicPaperField(publicPaper, 'tldr', publicString(paper?.tldr || paper?.plainSummary));
  addPublicPaperField(publicPaper, 'url', publicHttpUrl(paper?.url));
  addPublicPaperField(publicPaper, 'openAccessUrl', publicHttpUrl(paper?.openAccessUrl));
  addPublicPaperField(publicPaper, 'landingPageUrl', publicHttpUrl(paper?.landingPageUrl));
  addPublicPaperField(publicPaper, 'pdfUrl', publicHttpUrl(paper?.pdfUrl));
  addPublicPaperField(publicPaper, 'arxivId', publicString(paper?.arxivId));
  addPublicPaperField(publicPaper, 'doi', publicString(paper?.doi));
  addPublicPaperField(publicPaper, 'citationCount', publicPaperNumber(paper?.citationCount));
  addPublicPaperField(publicPaper, 'publishedAt', publicPaperDate(paper?.publishedAt));
  addPublicPaperField(publicPaper, 'postedAt', publicPaperDate(paper?.postedAt));
  addPublicPaperField(publicPaper, 'versionDate', publicPaperDate(paper?.versionDate));
  if (publicationStage && PUBLIC_PAPER_STAGES.has(publicationStage)) {
    publicPaper.publicationStage = publicationStage;
  }
  addPublicPaperField(publicPaper, 'preprintServer', publicString(paper?.preprintServer));

  return publicPaper;
};

const publicListingForResearchDetail = (listing: any) => ({
  _id: researchGroupDocumentId(listing._id),
  id: researchGroupDocumentId(listing._id),
  title: publicString(listing.title),
  description: publicString(listing.description),
  type: publicString(listing.type),
  commitment: publicString(listing.commitment),
  compensationType: publicString(listing.compensationType),
  applicantDescription: publicString(listing.applicantDescription),
  hiringStatus: publicString(listing.hiringStatus),
  websites: publicHttpUrls(listing.websites),
  departments: publicStringArray(listing.departments),
  researchAreas: publicStringArray(listing.researchAreas),
  keywords: publicStringArray(listing.keywords),
  expiresAt: listing.expiresAt,
});

const publicSourceUrls = (value: unknown): string[] => publicHttpUrls(value);

const publicPathwayText = (
  value: unknown,
  researchEntity: PublicResearchEntityDto,
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return redactDirectContactInfo(sanitizeFacultyResearchEntityText(value, researchEntity));
};

const publicEntryPathwayForResearchDetail = (
  pathway: any,
  researchEntity: PublicResearchEntityDto,
) => ({
  _id: pathway._id,
  pathwayType: pathway.pathwayType,
  status: pathway.status,
  evidenceStrength: pathway.evidenceStrength,
  studentFacingLabel: publicPathwayText(pathway.studentFacingLabel, researchEntity),
  explanation: publicPathwayText(pathway.explanation, researchEntity),
  bestNextStep: publicPathwayText(pathway.bestNextStep, researchEntity),
  compensation: pathway.compensation,
  sourceUrls: publicSourceUrls(pathway.sourceUrls),
  confidence: pathway.confidence,
  lastObservedAt: pathway.lastObservedAt,
});

const publicAccessSignalForResearchDetail = (signal: any) => ({
  signalType: signal.signalType,
  confidence: signal.confidence,
  confidenceScore: signal.confidenceScore,
  excerpt: publicString(signal.excerpt),
  sourceUrl: publicHttpUrl(signal.sourceUrl),
  observedAt: signal.observedAt,
});

const publicPostedOpportunityForResearchDetail = (opportunity: any) => ({
  _id: opportunity._id,
  title: publicString(opportunity.title),
  term: publicString(opportunity.term),
  deadline: opportunity.deadline,
  applicationUrl: publicHttpUrl(opportunity.applicationUrl),
  status: opportunity.status,
  hoursPerWeek: opportunity.hoursPerWeek,
  payRate: publicString(opportunity.payRate),
  compensationType: opportunity.compensationType,
  eligibility: publicString(opportunity.eligibility),
  sourceUrls: publicSourceUrls(opportunity.sourceUrls),
});

const publicResearchDetailGroup = (group: any) => {
  const {
    contactEmail: _contactEmail,
    contactName: _contactName,
    contactRole: _contactRole,
    contactPhone: _contactPhone,
    email: _email,
    phone: _phone,
    ...publicGroup
  } = group || {};
  return publicGroup;
};

export const MAX_RESEARCH_DETAIL_SLUG_LENGTH = 160;
const RESEARCH_DETAIL_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/i;

export const normalizeResearchDetailSlug = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_RESEARCH_DETAIL_SLUG_LENGTH) return undefined;
  return RESEARCH_DETAIL_SLUG_PATTERN.test(trimmed) ? trimmed : undefined;
};

/**
 * Detail payload for the lab page: the group itself, member User snapshots
 * (PIs first), the most recent papers across all members, and the group's
 * non-archived listings.
 */
export async function recordResearchEntityOutreach(
  slug: string,
  studentProfileId: unknown,
): Promise<{ recorded: true; routeUrl: string }> {
  const normalizedSlug = normalizeResearchDetailSlug(slug);
  if (!normalizedSlug || !mongoose.isValidObjectId(studentProfileId)) {
    throw new Error('INVALID_OUTREACH_REQUEST');
  }

  const entity = (await ResearchEntity.findOne({
    slug: normalizedSlug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('_id')
    .lean()) as { _id: mongoose.Types.ObjectId } | null;
  if (!entity) throw new Error('OUTREACH_ENTITY_NOT_FOUND');

  const candidateRoutes = (await ContactRoute.find({
    researchEntityId: entity._id,
    archived: { $ne: true },
    visibility: 'PUBLIC',
    'review.status': 'approved',
  })
    .sort({ priority: 1, updatedAt: -1 })
    .limit(MAX_PUBLIC_DETAIL_CONTACT_ROUTES)
    .lean()) as Array<Record<string, any>>;
  const route = candidateRoutes.find((candidate) =>
    isApprovedPublicContactRoute(candidate as Record<string, any>),
  );
  if (!route?.url) throw new Error('NO_APPROVED_OUTREACH_ROUTE');

  const now = new Date();
  const tracking = await StudentTracking.findOneAndUpdate(
    { studentProfileId, researchEntityId: entity._id },
    {
      $set: { stage: 'reached-out' },
      $setOnInsert: { studentProfileId, researchEntityId: entity._id },
      $push: { stageHistory: { stage: 'reached-out', timestamp: now } },
    },
    { upsert: true, new: true },
  );

  await StudentOutreach.create({
    studentProfileId,
    researchEntityId: entity._id,
    trackingId: tracking._id,
    reachedOutAt: now,
    deliveryMethod: 'official-route',
    emailGeneratedByPlatform: false,
    templateVersion: 'official-route-v1',
  });

  return { recorded: true, routeUrl: route.url };
}

export async function getResearchGroupDetail(slug: string): Promise<{
  researchEntity: PublicResearchEntityDto;
  members: Array<{ user: any; role: string }>;
  recentPapers: any[];
  recentArxivPreprints: any[];
  researchActivityLinks: any[];
  earlierResearchActivityLinks: any[];
  scholarlyLinks: any[];
  memberScholarlyLinks: any[];
  activeListings: any[];
  entryPathways: any[];
  accessSignals: any[];
  contactRoutes: any[];
  postedOpportunities: any[];
  entityRelationships: any[];
  relatedResearchEntities: PublicResearchEntitySummaryDto[];
  relatedResearchEntitiesMeta: PublicRelationshipCollectionMeta;
  affiliatedRelationships: any[];
  affiliatedResearchEntities: PublicResearchEntitySummaryDto[];
  affiliatedResearchEntitiesMeta: PublicRelationshipCollectionMeta;
} | null> {
  const normalizedSlug = normalizeResearchDetailSlug(slug);
  if (!normalizedSlug) return null;

  const group = await ResearchEntity.findOne({
    slug: normalizedSlug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();
  if (!group) return null;

  const memberRows: any[] = await ResearchGroupMember.find(
    currentResearchEntityMemberFilter((group as any)._id),
  )
    .sort({ role: 1, updatedAt: -1 })
    .limit(MAX_PUBLIC_DETAIL_MEMBERS)
    .lean();

  const memberUserIds = memberRows
    .map((row) => row.userId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const memberFacultyIds = memberRows
    .map((row) => row.facultyMemberId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);

  const [users, facultyMembers]: any[][] = await Promise.all([
    memberUserIds.length
      ? User.find({ _id: { $in: memberUserIds } }, PUBLIC_USER_FIELDS).lean()
      : Promise.resolve([]),
    memberFacultyIds.length
      ? FacultyMember.find({ _id: { $in: memberFacultyIds }, archived: { $ne: true } })
          .select(
            'netid userId name firstName lastName photoUrl primarySchool title bio email websiteUrl profileUrls',
          )
          .lean()
      : Promise.resolve([]),
  ]);

  const usersById = new Map<string, any>(
    users.flatMap((u) => {
      const id = researchGroupDocumentId(u._id);
      return id ? [[id, u] as const] : [];
    }),
  );
  const facultyMembersById = new Map<string, any>(
    facultyMembers.flatMap((faculty) => {
      const id = researchGroupDocumentId(faculty._id);
      return id ? [[id, faculty] as const] : [];
    }),
  );

  const ROLE_PRIORITY: Record<string, number> = {
    pi: 0,
    'co-pi': 1,
    director: 2,
    'co-director': 3,
    'core-faculty': 4,
    affiliated: 5,
    alumni: 6,
  };

  const membersWithRows = memberRows
    .map((row) => ({
      user: publicMemberUserForRow(row, usersById, facultyMembersById),
      role: row.role,
      row,
    }))
    .filter((m) => m.user !== null)
    .map((m) => ({
      ...m,
      user: {
        ...m.user,
        image_url: m.user.imageUrl || m.user.image_url,
        primary_department: m.user.primaryDepartment || m.user.primary_department,
      },
    }))
    .filter((member, index, rows) => {
      const userKey =
        member.user.netid ||
        researchGroupDocumentId(member.user._id) ||
        [member.user.fname, member.user.lname].filter(Boolean).join(' ');
      const key = `${(publicString(userKey) || '').toLowerCase()}:${member.role}`;
      return (
        index ===
        rows.findIndex((candidate) => {
          const candidateUserKey =
            candidate.user.netid ||
            researchGroupDocumentId(candidate.user._id) ||
            [candidate.user.fname, candidate.user.lname].filter(Boolean).join(' ');
          return (
            `${(publicString(candidateUserKey) || '').toLowerCase()}:${candidate.role}` === key
          );
        })
      );
    })
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));
  const imageGuardedMembersWithRows = await withPublicMemberImageGuards(membersWithRows);
  const dedupedMembersWithRows = dedupeSameNameLeadMembers(imageGuardedMembersWithRows, group);
  const piOutreachRoute = buildLeadPiOutreachContactRoute(dedupedMembersWithRows, group);
  const leadMemberNames = dedupedMembersWithRows
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => memberDisplayName(member))
    .filter((name): name is string => Boolean(name));
  const memberDisplayIds = Array.from(
    new Set(
      dedupedMembersWithRows
        .map((member) => member.user?._id)
        .filter(Boolean)
        .map(normalizeResearchGroupObjectId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const publicMemberKeysByInternalId = new Map(
    dedupedMembersWithRows
      .map((member) => {
        const id = normalizeResearchGroupObjectId(member.user?._id);
        return id ? [id, publicMemberKeyForResearchDetail(member.user, member.role)] : undefined;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
  const memberAppointmentsByInternalId = new Map(
    dedupedMembersWithRows.flatMap((member) => {
      const id = normalizeResearchGroupObjectId(member.user?._id);
      return id
        ? [[id, { startedAt: member.row?.startedAt, endedAt: member.row?.endedAt }] as const]
        : [];
    }),
  );
  const members = dedupedMembersWithRows.map(({ row: _row, ...member }) => {
    return {
      ...member,
      user: {
        ...publicMemberUserForResearchDetail(member.user),
        publicKey: publicMemberKeyForResearchDetail(member.user, member.role),
      },
    };
  });
  const attributionRows = memberDisplayIds.length
    ? await ResearchScholarlyAttribution.find({
        targetUserId: { $in: memberDisplayIds },
        archived: { $ne: true },
      })
        .select(
          'scholarlyLinkId targetUserId relationshipBasis evidenceLabel confidence observedAt sourceName sourceUrl',
        )
        .sort({ observedAt: -1, updatedAt: -1 })
        .limit(80)
        .lean()
    : [];
  const attributedScholarlyLinkIds = Array.from(
    new Set(
      attributionRows
        .map((row: any) => researchGroupDocumentId(row.scholarlyLinkId))
        .filter(Boolean),
    ),
  );

  const [
    recentPapersRaw,
    recentArxivPreprintsRaw,
    entityScholarlyLinks,
    attributedScholarlyLinks,
    activeListingsRaw,
    entryPathways,
    accessSignals,
    contactRoutes,
    postedOpportunities,
    accessSummary,
    planningContexts,
  ] = await Promise.all([
    memberUserIds.length
      ? Paper.find({
          yaleAuthorIds: { $in: memberUserIds },
          $or: [
            { publicationStage: { $exists: false } },
            { publicationStage: { $ne: 'PREPRINT' } },
          ],
        })
          .sort({ publishedAt: -1 })
          .limit(10)
          .lean()
      : Promise.resolve([]),
    memberUserIds.length
      ? Paper.find({
          archived: false,
          yaleAuthorIds: { $in: memberUserIds },
          $or: [{ preprintServer: 'arxiv' }, { publicationStage: 'PREPRINT' }],
        })
          .sort({ postedAt: -1, versionDate: -1, publishedAt: -1 })
          .limit(10)
          .lean()
      : Promise.resolve([]),
    ResearchScholarlyLink.find({
      researchEntityId: (group as any)._id,
      archived: { $ne: true },
    })
      .sort({ observedAt: -1, year: -1, updatedAt: -1 })
      .limit(10)
      .lean(),
    attributedScholarlyLinkIds.length
      ? ResearchScholarlyLink.find({
          _id: { $in: attributedScholarlyLinkIds },
          archived: { $ne: true },
        })
          .sort({ observedAt: -1, year: -1, updatedAt: -1 })
          .limit(20)
          .lean()
      : Promise.resolve([]),
    Listing.find({ researchEntityId: (group as any)._id, archived: false })
      .sort({ updatedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_LISTINGS)
      .lean(),
    EntryPathway.find({
      researchEntityId: (group as any)._id,
      archived: false,
      ...studentPathwayMongoMatch(),
    })
      .sort({ updatedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_ENTRY_PATHWAYS)
      .lean(),
    AccessSignal.find({ researchEntityId: (group as any)._id, archived: false })
      .sort({ observedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_ACCESS_SIGNALS)
      .lean(),
    ContactRoute.find(
      {
        researchEntityId: (group as any)._id,
        archived: false,
        visibility: 'PUBLIC',
        'review.status': 'approved',
      },
      'routeType label url priority visibility contactPolicy rationale sourceUrl observedAt review',
    )
      .sort({ priority: 1 })
      .limit(MAX_PUBLIC_DETAIL_CONTACT_ROUTES)
      .lean(),
    PostedOpportunity.find({ researchEntityId: (group as any)._id, archived: false })
      .sort({ deadline: 1 })
      .limit(MAX_PUBLIC_DETAIL_POSTED_OPPORTUNITIES)
      .lean(),
    getAccessSummaryForResearchEntity((group as any)._id),
    optionalPlanningContexts([(group as any)._id]),
  ]);
  const recentPapers = (recentPapersRaw as any[]).map(publicPaperForResearchDetail);
  const recentArxivPreprints = (recentArxivPreprintsRaw as any[]).map(publicPaperForResearchDetail);
  const entityContactRoutes = (contactRoutes as any[]).filter(
    (route) => !isResearchWebsiteFacultyPiRoute(route, group),
  );
  const publicContactRoutes = dedupePublicContactRoutes(
    piOutreachRoute ? [...entityContactRoutes, piOutreachRoute] : entityContactRoutes,
  ).map(publicContactRouteForResearchDetail);

  const scholarlyLinksById = new Map(
    (attributedScholarlyLinks as any[]).flatMap((link) => {
      const id = researchGroupDocumentId(link._id);
      return id ? [[id, link] as const] : [];
    }),
  );
  const memberScholarlyLinkPairs = (attributionRows as any[]).flatMap((row) => {
    const link = scholarlyLinksById.get(researchGroupDocumentId(row.scholarlyLinkId));
    if (!link) return [];
    const appointment = memberAppointmentsByInternalId.get(
      researchGroupDocumentId(row.targetUserId),
    );
    return [
      {
        link,
        memberDisplayId: publicMemberKeysByInternalId.get(
          researchGroupDocumentId(row.targetUserId),
        ),
        relationshipBasis: row.relationshipBasis,
        evidenceLabel: row.evidenceLabel,
        confidence: row.confidence,
        observedAt: row.observedAt,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl,
        appointmentStartedAt: appointment?.startedAt,
        appointmentEndedAt: appointment?.endedAt,
      },
    ];
  });
  const researchActivity = buildResearchActivityLinkPayload({
    researchEntityId: (group as any)._id,
    entityTopicEvidence: [
      (group as any).researchAreas,
      (group as any).methods,
      (group as any).shortDescription,
      (group as any).fullDescription,
      (group as any).name,
    ],
    entityScholarlyLinks: entityScholarlyLinks as any[],
    memberScholarlyLinkPairs,
  });

  const activeListings = activeListingsRaw.map(publicListingForResearchDetail);
  const publicGroup = sanitizeFacultyResearchEntityCopyFields(
    sanitizeResearchEntityPublicDescriptionFields(group as any, leadMemberNames),
    leadMemberNames,
  );
  const publicGroupForResponse = publicResearchDetailGroup(publicGroup);
  const publicEntryPathways = (entryPathways as any[]).map((pathway) =>
    publicEntryPathwayForResearchDetail(pathway, publicGroup),
  );
  const publicAccessSignals = (accessSignals as any[]).map(publicAccessSignalForResearchDetail);
  const publicPostedOpportunities = (postedOpportunities as any[]).map(
    publicPostedOpportunityForResearchDetail,
  );
  const studentDecisionExplanation = publicStudentDecisionExplanation(
    publicGroup.studentDecisionExplanation,
    {
      sourceUrls: [
        ...(Array.isArray(publicGroup.sourceUrls) ? publicGroup.sourceUrls : []),
        publicGroup.websiteUrl,
      ].filter(Boolean),
      accessSignals: publicAccessSignals,
      entryPathways: publicEntryPathways,
      contactRoutes: publicContactRoutes as any[],
      postedOpportunities: publicPostedOpportunities,
    },
  );
  const relationshipPayload = await listResearchEntityRelationshipPayload((group as any)._id);

  return addResearchEntityDetailAlias({
    group: {
      ...publicGroupForResponse,
      leadIdentityStatus:
        Array.isArray((publicGroupForResponse as any).qualitySummary?.repairFlags) &&
        (publicGroupForResponse as any).qualitySummary.repairFlags.includes('pi_identity_conflict')
          ? 'under_review'
          : 'verified',
      accessSummary,
      planningContext: planningContexts.get(researchGroupDocumentId((group as any)._id)),
      studentDecisionExplanation: studentDecisionExplanation || undefined,
    },
    members,
    ...researchActivity,
    recentPapers,
    recentArxivPreprints,
    activeListings,
    entryPathways: publicEntryPathways,
    accessSignals: publicAccessSignals,
    contactRoutes: publicContactRoutes,
    postedOpportunities: publicPostedOpportunities,
    ...relationshipPayload,
  });
}
