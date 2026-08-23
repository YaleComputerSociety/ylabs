/**
 * Service layer for canonical ResearchEntity browse/detail plus the
 * find-or-create helper that gives every Listing a parent entity on creation.
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
import { RoleAssignment } from '../models/roleAssignment';
import {
  getResearchEntityRoster,
  getResearchEntityRosterByEntityId,
  resolveResearcherIdForLegacyUser,
  type ResearchEntityRosterEntry,
} from './researchEntityMembershipAccessor';
import type { ResearcherProfileLink } from '../models/researcher';
import { Department, DepartmentCategory } from '../models/department';
import { Listing } from '../models/listing';
import { User } from '../models/user';
import { resolveOrCreateResearcherIdForIdentity } from '../scrapers/canonicalMembershipMaterializer';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { ResearchEntityRelationship } from '../models/researchEntityRelationship';
import { Signal } from '../models/signal';
import { StudentTracking } from '../models/studentTracking';
import { StudentOutreach } from '../models/studentOutreach';
import { getMeiliIndex } from '../utils/meiliClient';
import {
  isResearchEntitySearchEmbedderConfigured,
  RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
} from './researchEntitySearchIndexService';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { isDisallowedResearchEntitySourceUrl } from '../utils/researchHomeWebsiteUrl';
import {
  detectProfileIdentityRisk,
  entityOfficialPersonProfileDestinations,
  hasSpecificOfficialPersonPathSegment,
  normalizeOfficialProfileDestination,
  resolveLeadOfficialProfileUrl,
} from './leadProfileIdentity';
import {
  invalidateAdminAccessReviewProjection,
  refreshAdminAccessReviewProjection,
} from './adminAccessReviewProjectionService';
import {
  getAccessSummaryForResearchEntity,
  listAccessSummariesForResearchEntities,
} from './accessSummaryService';
import { buildResearchGroupFilterString, ResearchGroupFilterInput } from './researchGroupFilters';
import {
  buildResearchEntityQualitySummary,
  type ResearchEntityQualitySummary,
} from './researchEntityQuality';
import { accessSignalTypes, mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  toPublicResearchEntitySummaryDto,
  type PublicResearchEntityDto,
  type PublicResearchEntitySummaryDto,
} from './researchEntityDto';
import { isPublicResearchPaperLink, scholarlyLinkToPublicLink } from './profileService';
import {
  isLikelyPublicProfileImageUrl,
  isSharedProfileImageAcrossDifferentNames,
} from '../scripts/profileImageQualityAuditCore';
import { sanitizeResearchEntityPublicDescriptionFields } from '../utils/researchEntityDescriptionText';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  researchEntityServesPublicDetail,
} from './researchEntityPublicDescription';
import {
  researchEntityHasDeceasedLead,
  stripTrailingPersonNameLifespan,
} from '../utils/researchEntityDeceasedLead';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  canonicalScholarlyWorkKey,
  evaluateResearchActivityIntegrity,
  type ResearchActivityCandidate,
} from './researchActivityIntegrity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { sanitizePersonTitle } from '../utils/titleHygiene';
import {
  personNameHasLifespanSuffix,
  stripPersonNameLifespanSuffix,
} from '../utils/personNameLifespan';
import { sanitizeResearchAreaFacetDistribution } from '../utils/researchAreaLabelHygiene';
import { listPlanningContextsForResearchEntities } from './planningContextService';
import {
  getPublicUndergraduateLogistics,
  unavailablePublicUndergraduateLogistics,
  type PublicUndergraduateLogistics,
} from './undergraduateLogisticsService';

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

const optionalUndergraduateLogistics = async (
  entityId: unknown,
): Promise<PublicUndergraduateLogistics> => {
  try {
    return await getPublicUndergraduateLogistics(entityId);
  } catch (error) {
    console.error('Optional undergraduate-logistics enrichment failed:', sanitizeLogValue(error));
    return unavailablePublicUndergraduateLogistics();
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

  const ownerObjectId = normalizeResearchGroupObjectId(owner._id);
  let ownerPersonId = ownerObjectId
    ? await resolveResearcherIdForLegacyUser(ownerObjectId)
    : undefined;
  if (!ownerPersonId && ownerObjectId) {
    const ownerUser: any = await User.findById(ownerObjectId)
      .select('netid email orcid fname lname displayName')
      .lean();
    const ownerDisplayName =
      (typeof ownerUser?.displayName === 'string' && ownerUser.displayName.trim()) ||
      [ownerUser?.fname ?? owner.fname, ownerUser?.lname ?? owner.lname]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      undefined;
    ownerPersonId = await resolveOrCreateResearcherIdForIdentity({
      netid: ownerUser?.netid ?? owner.netid,
      email: ownerUser?.email,
      orcid: ownerUser?.orcid,
      displayName: ownerDisplayName,
      hasCanonicalSourceReference: true,
    });
  }
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
  let projectionGeneration: number | null = null;
  await mongoose.connection.transaction(async (session) => {
    group = await ResearchEntity.findOneAndUpdate({ slug }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session,
    }).lean();
    projectionGeneration = await invalidateAdminAccessReviewProjection(group._id, { session });
  });
  if (projectionGeneration !== null) {
    await refreshAdminAccessReviewProjection(group._id, projectionGeneration);
  }

  if (ownerPersonId) {
    const now = new Date();
    await RoleAssignment.updateOne(
      {
        personId: ownerPersonId,
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': group._id,
        role: 'PI',
      },
      {
        $set: {
          personId: ownerPersonId,
          target: { kind: 'RESEARCH_ENTITY', id: group._id },
          role: 'PI',
          state: 'CURRENT',
          confidence: 1,
          reviewStatus: 'UNREVIEWED',
          archived: false,
        },
        $setOnInsert: { startedAt: now, evidenceClaimIds: [] },
        $unset: { endedAt: '' },
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
  return getResearchEntityRoster(safeGroupId);
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
]);

const STUDENT_QUERY_ALIASES: Record<string, string[]> = {
  ai: ['artificial intelligence', 'machine learning', 'deep learning', 'ai'],
  ml: ['machine learning', 'artificial intelligence', 'deep learning', 'ml'],
  nlp: ['natural language processing', 'computational linguistics', 'nlp'],
  cv: ['computer vision', 'image analysis', 'visual recognition', 'cv'],
  neuro: ['neuroscience', 'neurology', 'neural', 'brain', 'neuro'],
  psych: ['psychology', 'psychiatry', 'cognitive science', 'behavioral science', 'psych'],
};

const DEPARTMENT_SHORTHAND_ALIASES: Record<string, string[]> = {
  cs: ['computer science'],
  compsci: ['computer science'],
  'comp sci': ['computer science'],
  econ: ['economics'],
  poli: ['political science'],
  polisci: ['political science'],
  'poli sci': ['political science'],
  'pol sci': ['political science'],
  bio: ['biology'],
  biol: ['biology'],
  chem: ['chemistry'],
  math: ['mathematics'],
  stat: ['statistics'],
  stats: ['statistics'],
  socio: ['sociology'],
  anthro: ['anthropology'],
  phil: ['philosophy'],
  philo: ['philosophy'],
  ling: ['linguistics'],
  astro: ['astronomy', 'astrophysics'],
  hist: ['history'],
  lit: ['literature'],
  ee: ['electrical engineering'],
  'elec eng': ['electrical engineering'],
  meche: ['mechanical engineering'],
  'mech eng': ['mechanical engineering'],
  bme: ['biomedical engineering'],
  biomed: ['biomedical engineering'],
  eeb: ['ecology and evolutionary biology'],
  mcdb: ['molecular cellular and developmental biology'],
  mbb: ['molecular biophysics and biochemistry'],
  eall: ['east asian languages and literatures'],
  nelc: ['near eastern languages and civilizations'],
  wgss: ['women gender and sexuality studies'],
};

const QUERY_TOPIC_ALIASES: Record<string, string[]> = {
  ...STUDENT_QUERY_ALIASES,
  ...DEPARTMENT_SHORTHAND_ALIASES,
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
  aliasTerms: string[] | null;
}

export const normalizeResearchSearchQuery = (value: unknown): NormalizedResearchSearchQuery => {
  const raw = boundedResearchSearchQuery(value);
  const tokens = tokenizeStudentResearchQuery(raw);
  const meaningfulTokens = tokens.filter((token) => !STUDENT_QUERY_STOP_WORDS.has(token));
  const queryTokens = meaningfulTokens.length > 0 ? meaningfulTokens : tokens;
  const aliasExpansion = resolveTopicAliasExpansion(queryTokens);
  const expandedTerms = aliasExpansion
    ? aliasExpansion
    : queryTokens.flatMap((token) => STUDENT_QUERY_ALIASES[token] || [token]);
  const normalizedTerms = uniqueQueryTerms(expandedTerms);

  return {
    raw,
    query: normalizedTerms.join(' ').slice(0, MAX_SEARCH_QUERY_LENGTH),
    tokens: queryTokens,
    isTopicAliasQuery: aliasExpansion !== null,
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
  acceptanceLevel: isAcceptanceLevelInput(filters.acceptanceLevel)
    ? filters.acceptanceLevel
    : undefined,
  hostsUndergrads: filters.hostsUndergrads === true ? true : undefined,
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
  if (filters.school?.length) mongoFilter.schools = { $in: filters.school };
  if (filters.departments?.length) mongoFilter.departments = { $in: filters.departments };
  if (filters.researchAreas?.length) mongoFilter.researchAreas = { $in: filters.researchAreas };
  if (filters.acceptanceLevel === 'verified') {
    mongoFilter.accessAcceptanceLevel = 'verified';
  } else if (filters.acceptanceLevel === 'verified-or-likely') {
    mongoFilter.accessAcceptanceLevel = { $in: ['verified', 'likely'] };
  }
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
export const dropCoincidentalTypoOnlyHits = <T>(
  hits: T[],
): { hits: T[]; dropped: number } => {
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
  hitStringFieldValues(hit, field).some((value) => aliasTermSet.has(normalizeExactMatchValue(value)));

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
export const promoteExactAliasFieldMatches = <T>(
  hits: T[],
  aliasTerms: string[] | null,
): T[] => {
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
  filterKey: 'school' | 'departments' | 'researchAreas';
  meiliField: 'schools' | 'departments' | 'researchAreas';
}> = [
  { filterKey: 'school', meiliField: 'schools' },
  { filterKey: 'departments', meiliField: 'departments' },
  { filterKey: 'researchAreas', meiliField: 'researchAreas' },
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
  const safePage = Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
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
  if (isUnsearchableQuery) {
    return addResearchEntitySearchAliases(
      {
        hits: [],
        estimatedTotalHits: 0,
        page: safePage,
        pageSize: safePageSize,
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
    const [accessSummaries, planningContextResult] = await Promise.all([
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
          planningContext: planningContextResult.contexts.get(researchGroupDocumentId(entity._id)),
        })),
        estimatedTotalHits: filteredCandidates.length,
        page: safePage,
        pageSize: safePageSize,
        degraded: planningContextResult.degraded,
      },
      { includeOperatorFields: safeOptions.includeNonPublic },
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
    facets: ['schools', 'departments', 'researchAreas'],
  };
  if (sortConfig.length > 0) {
    searchParams.sort = sortConfig;
  }

  const index = await getMeiliIndex('researchentities');
  if (!isBrowseAllQuery) {
    if (normalizedQuery.isTopicAliasQuery) {
      searchParams.attributesToSearchOn = TOPIC_ALIAS_QUERY_ATTRIBUTES;
    } else if (await isResearchEntitySearchEmbedderConfigured(index)) {
      searchParams.hybrid = {
        semanticRatio: 0.8,
        embedder: 'default',
      };
      searchParams.rankingScoreThreshold = HYBRID_RANKING_SCORE_THRESHOLD;
      searchParams.showRankingScoreDetails = true;
    }
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
        rankingScoreThreshold: finalSearchParams.rankingScoreThreshold,
        page: 1,
        hitsPerPage: RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
        attributesToRetrieve: ['id'],
        facets: ['schools', 'departments', 'researchAreas'],
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
      console.error(
        'Optional exhaustive hybrid total-hits count failed:',
        sanitizeLogValue(error),
      );
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
    if (finalSearchParams.rankingScoreThreshold !== undefined) {
      params.hybrid = finalSearchParams.hybrid;
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

  const { hits: keywordFilteredHits, dropped: droppedCoincidentalHits } =
    dropCoincidentalTypoOnlyHits(hits || []);
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
  const [accessSummaries, planningContextResult] = await Promise.all([
    listAccessSummariesForResearchEntities(visibleHitIds),
    optionalPlanningContexts(visibleHitIds),
  ]);
  const normalizedHits = orderedHits.flatMap((hit: any) => {
    const id = hit.id || hit._id;
    const entityId = researchGroupDocumentId(id);
    const entity = visibleEntitiesById.get(entityId);
    if (!entity) return [];
    return {
      ...entity,
      _id: id,
      hasActiveListing: activeListingGroupIdSet.has(entityId),
      accessSummary: accessSummaries.get(entityId),
      planningContext: planningContextResult.contexts.get(entityId),
      ...(hit.searchMatch ? { searchMatch: hit.searchMatch } : {}),
    };
  });

  const adjustedTotalHits =
    typeof resolvedTotalHits === 'number'
      ? Math.max(normalizedHits.length, resolvedTotalHits - droppedCoincidentalHits)
      : normalizedHits.length;

  return addResearchEntitySearchAliases(
    {
      hits: normalizedHits,
      estimatedTotalHits: adjustedTotalHits,
      page: safePage,
      pageSize: safePageSize,
      facetDistribution,
      degraded: degraded || planningContextResult.degraded,
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
  const safePage = Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
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
    filterKey: 'school' | 'departments' | 'researchAreas',
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
  const [schoolFacetCounts, departmentFacetCounts, researchAreaFacetCounts] = await Promise.all([
    disjunctiveMongoFacetCounts('school', 'schools'),
    disjunctiveMongoFacetCounts('departments', 'departments'),
    disjunctiveMongoFacetCounts('researchAreas', 'researchAreas'),
  ]);
  const facetDistribution = {
    school: schoolFacetCounts,
    departments: departmentFacetCounts,
    researchAreas: sanitizeResearchAreaFacetDistribution(researchAreaFacetCounts) ?? {},
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

const hasPublicMemberProfileUrls = (value: Record<string, any>): boolean =>
  Boolean(value.profileUrls && Object.keys(value.profileUrls).length > 0);

const addPublicMemberField = (target: Record<string, any>, key: string, value: any) => {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
};

const publicPersonNameField = (value: any): any => {
  if (typeof value !== 'string') return value;
  return stripPersonNameLifespanSuffix(value) || value;
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
    if (link && kinds.has(link.kind) && typeof link.url === 'string' && link.url.trim()) {
      return link.url.trim();
    }
  }
  return undefined;
};

function canonicalMemberUserForResearchDetail(entry: ResearchEntityRosterEntry): any {
  const displayName = stripTrailingPersonNameLifespan(entry.name || '');
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
    const internalProfilePath = publicInternalProfilePath(entry.netid);
    if (internalProfilePath) {
      publicUser.internalProfilePath = internalProfilePath;
      publicUser.internal_profile_path = internalProfilePath;
    } else {
      const website =
        publicHttpUrl(
          canonicalProfileLinkUrl(entry.profileLinks, CANONICAL_PROFILE_LINK_WEBSITE_KINDS),
        ) || publicHttpUrl(entry.websiteUrl);
      if (website) {
        publicUser.website = website;
        publicUser.websiteUrl = website;
      }
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

const PUBLIC_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

export const currentResearchEntityMemberFilter = (researchEntityId: unknown) => ({
  researchEntityId,
  archived: { $ne: true },
  isCurrentMember: { $ne: false },
});

const MAX_PUBLIC_DETAIL_MEMBERS = 100;
const MAX_PUBLIC_DETAIL_LISTINGS = 50;
const MAX_PUBLIC_DETAIL_ACCESS_SIGNALS = 50;
const MAX_PUBLIC_DETAIL_RELATIONSHIPS_PER_DIRECTION = 50;
const MAX_PUBLIC_DETAIL_RELATIONSHIP_QUERY_LIMIT = 51;
const PUBLIC_RELATED_ENTITY_PROJECTION =
  '_id slug name displayName kind entityType departments shortDescription fullDescription studentVisibilityTier descriptionSource sourceUrls website websiteUrl';

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

  const publicEntitiesByInternalId = new Map(
    publicRelatedEntities.map((entity) => [
      researchGroupDocumentId(entity._id),
      toPublicResearchEntitySummaryDto(sanitizeResearchEntityPublicDescriptionFields(entity)),
    ]),
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
  rawLeadMembers?: Array<Record<string, any>>,
): { leadIdentityStatus: 'verified' | 'under_review'; leadProfessorPublicKey?: string } {
  const leadMembers = members.filter((member) => PUBLIC_LEAD_ROLES.has(member.role));
  if (leadMembers.some((member) => member.row?.reviewStatus === 'DISPUTED')) {
    return { leadIdentityStatus: 'under_review' };
  }
  if (leadMembers.some((member) => personNameHasLifespanSuffix(memberDisplayName(member)))) {
    return { leadIdentityStatus: 'under_review' };
  }
  const qualitySummary = buildResearchEntityQualitySummary({
    entity: group,
    leadMembers:
      rawLeadMembers || leadMembers.map((member) => ({ ...member.row, user: member.user })),
  });
  if (qualitySummary.repairFlags.includes('pi_identity_conflict')) {
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

export function buildResearchActivityLinkPayload({
  researchEntityId,
  entityTopicEvidence = [],
  entityScholarlyLinks = [],
  memberScholarlyLinkPairs = [],
}: {
  researchEntityId: unknown;
  entityTopicEvidence?: unknown;
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

const publicResearchDetailSourceUrl = (value: unknown): string | undefined => {
  const url = publicHttpUrl(value);
  if (!url || isDisallowedResearchEntitySourceUrl(url)) return undefined;
  return url;
};

const publicAccessSignalForResearchDetail = (signal: any) => ({
  signalType: signal.type,
  confidence: signal.confidence,
  confidenceScore: signal.confidenceScore,
  excerpt: publicString(signal.source?.excerpt),
  sourceUrl: publicResearchDetailSourceUrl(signal.source?.url),
  observedAt: signal.observedAt,
});

const publicSourceLinkHealth = (
  value: unknown,
): Array<{
  url: string;
  healthStatus: string;
  httpStatusCode?: number;
}> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const url = publicHttpUrl((entry as { url?: unknown })?.url);
    const healthStatus = (entry as { healthStatus?: unknown })?.healthStatus;
    if (!url || typeof healthStatus !== 'string') return [];
    const httpStatusCode = (entry as { httpStatusCode?: unknown })?.httpStatusCode;
    return [
      {
        url,
        healthStatus,
        ...(typeof httpStatusCode === 'number' && Number.isFinite(httpStatusCode)
          ? { httpStatusCode }
          : {}),
      },
    ];
  });
};

const publicResearchDetailGroup = (group: any) => {
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
  if (Array.isArray(publicGroup.sourceUrls)) {
    publicGroup.sourceUrls = publicGroup.sourceUrls.filter(
      (url: unknown) => !isDisallowedResearchEntitySourceUrl(url),
    );
  }
  return {
    ...publicGroup,
    sourceLinkHealth: publicSourceLinkHealth(rawSourceLinkHealth),
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

/**
 * Public research-detail payload.
 *
 * Lead members remain first. Non-lead official-roster members are returned only
 * while their stable identity and snapshot evidence are verified and fresh, are
 * capped at 24, and carry public source/profile provenance. The separate roster
 * disclosure distinguishes current, partial, withheld, no-verified-data, and
 * optional-source-failure states so absence never implies an empty team.
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
    .select('_id websiteUrl')
    .lean()) as { _id: mongoose.Types.ObjectId; websiteUrl?: string } | null;
  if (!entity) throw new Error('OUTREACH_ENTITY_NOT_FOUND');

  const routeUrl = publicHttpUrl(entity.websiteUrl);
  if (!routeUrl) throw new Error('NO_APPROVED_OUTREACH_ROUTE');

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

  return { recorded: true, routeUrl };
}

const MAX_CANONICAL_REDIRECT_HOPS = 10;

export async function resolveArchivedResearchEntityCanonicalSlug(
  slug: string,
): Promise<string | null> {
  const normalizedSlug = normalizeResearchDetailSlug(slug);
  if (!normalizedSlug) return null;

  const archivedEntity = (await ResearchEntity.findOne({
    slug: normalizedSlug,
    archived: true,
    canonicalGroupId: { $ne: null },
  })
    .select('_id canonicalGroupId')
    .lean()) as {
    _id?: mongoose.Types.ObjectId;
    canonicalGroupId?: mongoose.Types.ObjectId;
  } | null;
  if (!archivedEntity?.canonicalGroupId) return null;

  const visited = new Set<string>();
  if (archivedEntity._id) visited.add(String(archivedEntity._id));

  let nextId: mongoose.Types.ObjectId | null | undefined = archivedEntity.canonicalGroupId;
  for (let hop = 0; hop < MAX_CANONICAL_REDIRECT_HOPS && nextId; hop += 1) {
    const nextKey = String(nextId);
    if (visited.has(nextKey)) return null;
    visited.add(nextKey);

    const candidate = (await ResearchEntity.findOne({ _id: nextId })
      .select('slug archived studentVisibilityTier canonicalGroupId')
      .lean()) as {
      slug?: string;
      archived?: boolean;
      studentVisibilityTier?: StudentVisibilityTier;
      canonicalGroupId?: mongoose.Types.ObjectId | null;
    } | null;
    if (!candidate) return null;

    const isLivePublic =
      candidate.archived !== true &&
      !!candidate.studentVisibilityTier &&
      publicStudentVisibilityTiers.includes(candidate.studentVisibilityTier);
    if (isLivePublic) {
      const canonicalSlug = candidate.slug ? String(candidate.slug) : '';
      if (!canonicalSlug || canonicalSlug === normalizedSlug) return null;
      return canonicalSlug;
    }

    nextId = candidate.canonicalGroupId ?? null;
  }

  return null;
}

export async function getResearchGroupDetail(slug: string): Promise<{
  researchEntity: PublicResearchEntityDto;
  members: Array<{ user: any; role: string }>;
  roster: PublicRosterDisclosure;
  researchActivityLinks: any[];
  earlierResearchActivityLinks: any[];
  scholarlyLinks: any[];
  memberScholarlyLinks: any[];
  activeListings: any[];
  accessSignals: any[];
  undergraduateLogistics: PublicUndergraduateLogistics;
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
  if (researchEntityHasDeceasedLead(group as Record<string, any>)) return null;

  const ROLE_PRIORITY: Record<string, number> = {
    pi: 0,
    'co-pi': 1,
    director: 2,
    'co-director': 3,
    'core-faculty': 4,
    affiliated: 5,
    alumni: 6,
  };

  const rosterEntries = await getResearchEntityRoster((group as any)._id);
  const currentRosterEntries = rosterEntries
    .filter((entry) => entry.state !== 'HISTORICAL')
    .filter(
      (entry) =>
        entry.rosterProvenance?.sourceName !== OFFICIAL_ROSTER_SOURCE_NAME ||
        isFreshVerifiedOfficialRosterRow(
          canonicalRosterMemberRow(entry),
          new Date(),
          (group as any).rosterEnrichment,
        ),
    )
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99))
    .slice(0, MAX_PUBLIC_DETAIL_MEMBERS);

  const canonicalMembers = currentRosterEntries
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
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));
  const corroboratedMembers = dropUncorroboratedPhantomLeads(canonicalMembers);
  const imageGuardedMembersWithRows = await withPublicMemberImageGuards(corroboratedMembers);
  const dedupedMembersWithRows = dedupeSameNameLeadMembers(imageGuardedMembersWithRows, group);
  const rawLeadMembers = dedupedMembersWithRows
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => ({
      name: memberDisplayName(member),
      role: member.role,
      user: member.user,
    }));
  const leadIdentity = researchDetailLeadIdentity(
    group as Record<string, any>,
    dedupedMembersWithRows,
    rawLeadMembers,
  );
  const leadMemberNames = dedupedMembersWithRows
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => memberDisplayName(member))
    .filter((name): name is string => Boolean(name));
  const publicDescription = buildResearchEntityPublicDescriptionRepresentation({
    entity: group as any,
    leadMemberNames,
  });
  if (!publicDescription.invariant.pass) return null;
  const publicGroup = publicDescription.entity;
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
        return id
          ? [
              id,
              publicMemberKeyForResearchDetail(member.user, member.role, member.row?.identityKey),
            ]
          : undefined;
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
    entityScholarlyLinks,
    attributedScholarlyLinks,
    activeListingsRaw,
    accessSignals,
    accessSummary,
    planningContexts,
    undergraduateLogistics,
  ] = await Promise.all([
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
    Signal.find({
      researchEntityId: (group as any)._id,
      type: { $in: accessSignalTypes },
      archived: false,
    })
      .sort({ observedAt: -1 })
      .limit(MAX_PUBLIC_DETAIL_ACCESS_SIGNALS)
      .lean(),
    getAccessSummaryForResearchEntity((group as any)._id),
    optionalPlanningContexts([(group as any)._id]),
    optionalUndergraduateLogistics((group as any)._id),
  ]);

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
  const publicGroupForResponse = publicResearchDetailGroup(publicGroup);
  const publicAccessSignals = (accessSignals as any[]).map(publicAccessSignalForResearchDetail);
  const relationshipPayload = await listResearchEntityRelationshipPayload((group as any)._id);

  return addResearchEntityDetailAlias({
    group: {
      ...publicGroupForResponse,
      ...leadIdentity,
      accessSummary,
      planningContext: planningContexts.contexts.get(researchGroupDocumentId((group as any)._id)),
    },
    members,
    roster,
    ...researchActivity,
    activeListings,
    accessSignals: publicAccessSignals,
    undergraduateLogistics,
    ...relationshipPayload,
  });
}
