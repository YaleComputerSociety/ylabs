/**
 * Service layer for canonical ResearchEntity browse/detail plus the
 * find-or-create helper for profile-first faculty contribution flows.
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
import mongoose, { type PipelineStage } from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { Department, DepartmentCategory } from '../models/department';
import { User } from '../models/user';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { getMeiliIndex } from '../utils/meiliClient';
import {
  getAccessSummaryForResearchEntity,
  listAccessSummariesForResearchEntities,
} from './accessSummaryService';
import { buildResearchGroupFilterString, ResearchGroupFilterInput } from './researchGroupFilters';
import { publicStudentVisibilityTiers, type StudentVisibilityTier } from '../models/studentVisibility';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  publicResearchAreaArray,
  type PublicResearchEntityDto,
} from './researchEntityDto';
import { buildResearchSearchQuerySemantics } from './researchSearchQuerySemantics';
import { rankResearchEntityCandidates, type ResearchSearchMode } from './researchSearchRanking';
import { computePathwayQuality, listWaysInForResearchEntities } from './pathwaySearchService';
import {
  listPublicMemberScholarlyLinks,
  listPublicScholarlyLinksForResearchEntity,
  withResearchActivityRelationship,
} from './scholarlyLinkService';
import {
  listAffiliatedResearchEntitiesForDetail,
  listRelatedResearchEntitiesForDetail,
} from './researchEntityRelationshipService';
import {
  isResearchEntitySourceChromeText,
  publicResearchEntityDescriptionText,
  sanitizeResearchEntityPublicDescriptionFields,
} from '../utils/researchEntityDescriptionText';
import {
  firstUsableResearchWebsiteUrl,
  isUsableResearchWebsiteUrl,
} from '../utils/researchWebsiteUrl';
import { publicSourceUrl, publicSourceUrls } from '../utils/publicSourceUrl';
import { httpUrlHasHostSuffix } from '../utils/urlNormalization';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  buildResearchEntityQualitySummary,
} from './researchEntityQuality';

const NON_LAB_CATEGORIES = new Set<string>([
  DepartmentCategory.SOCIAL_SCIENCES,
  DepartmentCategory.HUMANITIES_ARTS,
  DepartmentCategory.ECONOMICS,
]);

export interface OwnerLike {
  _id?: any;
  netid?: string;
  fname?: string;
  lname?: string;
  primaryDepartment?: string;
  departments?: string[];
  secondaryDepartments?: string[];
  topics?: string[];
  researchInterests?: string[];
  website?: string;
  profileUrls?: Record<string, unknown>;
  bio?: string;
}

export interface ResearchSearchSuggestion {
  label: string;
  query: string;
}

const DEFAULT_RESEARCH_SEARCH_SUGGESTIONS: ResearchSearchSuggestion[] = [
  { label: 'machine learning', query: 'machine learning' },
  { label: 'public health', query: 'public health' },
  { label: 'archival research', query: 'archival research' },
  { label: 'climate policy', query: 'climate policy' },
  { label: 'social science data', query: 'social science data' },
  { label: 'wet lab', query: 'wet lab' },
];

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

function sourceUrlsFromOwner(owner: OwnerLike): string[] {
  const profileUrls =
    owner.profileUrls && typeof owner.profileUrls === 'object'
      ? Object.values(owner.profileUrls)
      : [];
  return uniqueStrings(
    [...profileUrls, owner.website]
      .filter((value): value is string => typeof value === 'string')
      .filter((url) => /^https?:\/\//i.test(url)),
    8,
  );
}

function researchAreasFromOwner(owner: OwnerLike): string[] {
  return publicResearchAreaArray([
    ...(Array.isArray(owner.topics) ? owner.topics : []),
    ...(Array.isArray(owner.researchInterests) ? owner.researchInterests : []),
  ]);
}

const normalizeSuggestionText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const isLowQualitySuggestionText = (value: string): boolean => {
  if (/^publications?$/i.test(value)) return true;
  if (/\band\b/i.test(value) && /\bresearch$/i.test(value)) return true;
  return false;
};

const suggestionFromText = (value: string): ResearchSearchSuggestion | null => {
  if (isResearchEntitySourceChromeText(value)) return null;
  const text = normalizeSuggestionText(value);
  if (isResearchEntitySourceChromeText(text)) return null;
  if (isLowQualitySuggestionText(text)) return null;
  if (!text || text.length < 4) return null;
  return { label: text, query: text };
};

export async function listResearchSearchSuggestions(
  limit = 6,
): Promise<ResearchSearchSuggestion[]> {
  const safeLimit = Math.min(12, Math.max(1, Math.floor(limit) || 6));
  const rows = await ResearchEntity.aggregate([
    { $match: { archived: { $ne: true } } },
    { $unwind: '$researchAreas' },
    {
      $project: {
        area: { $trim: { input: '$researchAreas' } },
      },
    },
    { $match: { area: { $ne: '' } } },
    {
      $group: {
        _id: '$area',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    { $limit: Math.max(safeLimit * 6, 24) },
  ]);

  const seen = new Set<string>();
  const suggestions: ResearchSearchSuggestion[] = [];

  for (const fallback of DEFAULT_RESEARCH_SEARCH_SUGGESTIONS) {
    if (suggestions.length >= safeLimit) break;
    seen.add(fallback.query);
    suggestions.push(fallback);
  }

  for (const row of rows as Array<{ _id?: string }>) {
    if (suggestions.length >= safeLimit) break;
    const suggestion = suggestionFromText(row._id || '');
    if (!suggestion || seen.has(suggestion.query)) continue;
    seen.add(suggestion.query);
    suggestions.push(suggestion);
  }

  return suggestions;
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

  if (owner._id && mongoose.Types.ObjectId.isValid(owner._id)) {
    const existingMember = await ResearchGroupMember.findOne({
      userId: owner._id,
      role: 'pi',
    }).lean();
    if (existingMember) {
      const group = await ResearchEntity.findById((existingMember as any).researchEntityId).lean();
      if (group) return { group, created: false };
    }
  }

  const kind = await inferKindFromDepartment(owner.primaryDepartment);
  const slug = ownerSlugSeed(owner, kind);
  const name = ownerDisplayName(owner, kind);
  const sourceUrls = sourceUrlsFromOwner(owner);
  const researchAreas = researchAreasFromOwner(owner);
  const profileDescription = publicResearchEntityDescriptionText(owner.bio);
  const departments = uniqueStrings(
    [
      ...(Array.isArray(owner.departments) ? owner.departments : []),
      owner.primaryDepartment || '',
      ...(Array.isArray(owner.secondaryDepartments) ? owner.secondaryDepartments : []),
    ],
    10,
  );

  const update: any = {
    $setOnInsert: {
      slug,
      name,
      kind,
      entityType: mapResearchGroupKindToEntityType(kind),
      openness: 'unknown',
      lastObservedAt: new Date(),
      sourceUrls,
      departments,
      researchAreas,
      ...(profileDescription
        ? {
            profileSynthesisDescription: profileDescription,
            descriptionSource: 'PI_PROFILE_SYNTHESIS',
          }
        : {}),
    },
  };

  const group: any = await ResearchEntity.findOneAndUpdate({ slug }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  }).lean();

  if (owner._id && mongoose.Types.ObjectId.isValid(owner._id)) {
    await ResearchGroupMember.updateOne(
      { researchEntityId: group._id, userId: owner._id },
      {
        $setOnInsert: {
          researchEntityId: group._id,
          userId: owner._id,
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
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return ResearchEntity.findById(id).lean();
}

export async function getResearchGroupBySlug(slug: string): Promise<any | null> {
  return ResearchEntity.findOne({ slug }).lean();
}

export async function listMembersOfGroup(groupId: any): Promise<any[]> {
  if (!mongoose.Types.ObjectId.isValid(groupId)) return [];
  return ResearchGroupMember.find({ researchEntityId: groupId }).lean();
}

export interface ResearchGroupSearchSort {
  sortBy?: 'lastObservedAt' | 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export type ResearchGroupQualityFilter =
  | 'description-issue'
  | 'missing-lead'
  | 'profile-fallback';

export interface ResearchGroupSearchOptions {
  lowQualityFirst?: boolean;
  includeQualitySummary?: boolean;
  qualityFilters?: ResearchGroupQualityFilter[];
  studentVisibilityTiers?: StudentVisibilityTier[];
  includeSuppressed?: boolean;
}

export interface ResearchGroupSearchResult {
  researchEntities: PublicResearchEntityDto[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;
const CANDIDATE_MULTIPLIER = 4;
const FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];
const DIRECT_ACCESS_SIGNAL_TYPES = [
  'POSTED_OPENING',
  'APPLICATION_FORM_EXISTS',
  'CURRENT_UNDERGRADS',
  'PAST_UNDERGRADS',
  'FACULTY_SUPERVISES_STUDENT_PROJECTS',
  'CONTACT_INSTRUCTIONS_EXIST',
  'LAB_MANAGER_LISTED',
  'PROGRAM_MANAGER_LISTED',
];
const LEAD_RESEARCH_AREA_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

const normalizeSearchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const textValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(textValue).join(' ');
  if (value === undefined || value === null) return '';
  return String(value);
};

const uniqueStrings = (values: string[], limit: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

const dedupeResearchHits = (hits: any[]): any[] => {
  const seen = new Set<string>();
  const out: any[] = [];

  for (const hit of hits) {
    const stableId = String(hit.slug || hit.id || hit._id || '').toLowerCase();
    const labelKey = normalizeSearchText(textValue([hit.displayName, hit.name]));
    const key = stableId || labelKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }

  return out;
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

const hasResearchGroupFilters = (filters: ResearchGroupFilterInput): boolean =>
  Boolean(
    (filters.kind || []).length > 0 ||
    (filters.school || []).length > 0 ||
    (filters.departments || []).length > 0 ||
    (filters.researchAreas || []).length > 0 ||
    (filters.openness || []).length > 0 ||
    typeof filters.acceptingUndergrads === 'boolean' ||
    (filters.acceptanceLevel && filters.acceptanceLevel !== 'all'),
  );

const evidenceScoreExpression = {
  $add: [
    { $multiply: ['$_postedOpportunityCount', 1000] },
    { $multiply: ['$_directAccessSignalCount', 120] },
    { $multiply: ['$_strongAccessSignalCount', 80] },
    { $multiply: ['$_accessSignalCount', 35] },
    { $multiply: ['$_actionablePathwayCount', 25] },
    { $multiply: ['$_officialYaleSourceCount', 18] },
    { $min: [{ $multiply: ['$_sourceUrlCount', 4] }, 32] },
    { $cond: [{ $gt: [{ $ifNull: ['$currentUndergradCount', 0] }, 0] }, 20, 0] },
    {
      $round: [{ $multiply: [{ $ifNull: ['$acceptanceConfidence', 0] }, 20] }, 0],
    },
    { $cond: [{ $gt: [{ $ifNull: ['$recentPaperCount', 0] }, 0] }, 8, 0] },
    { $cond: ['$_hasDescriptionEvidence', 6, 0] },
  ],
};

const shouldShowLowQualityResearchFirst = (options: ResearchGroupSearchOptions = {}): boolean =>
  Boolean(options.lowQualityFirst);

const visibleTierMatch = (options: ResearchGroupSearchOptions = {}) => {
  const tiers = options.studentVisibilityTiers?.length
    ? options.studentVisibilityTiers
    : options.includeSuppressed || shouldShowLowQualityResearchFirst(options)
      ? []
      : publicStudentVisibilityTiers;
  if (tiers.length === 0) return {};
  return { studentVisibilityTier: { $in: tiers } };
};

const qualityFilterMatchStage = (
  filters: ResearchGroupQualityFilter[] = [],
): PipelineStage.Match | null => {
  const match: PipelineStage.Match['$match'] = {};
  if (filters.includes('description-issue')) match._qualityDescriptionIssue = true;
  if (filters.includes('missing-lead')) match._qualityMissingLead = true;
  if (filters.includes('profile-fallback')) match._qualityProfileFallback = true;
  return Object.keys(match).length > 0 ? { $match: match } : null;
};

const stripInternalQualityFields = (hit: Record<string, any>): Record<string, any> => {
  const {
    _leadMembers,
    _qualityDescriptionIssue,
    _qualityMissingLead,
    _qualityProfileFallback,
    _qualityRepairScore,
    ...publicHit
  } = hit;
  return publicHit;
};

const addQualitySummaryToHit = (
  hit: Record<string, any>,
  options: ResearchGroupSearchOptions = {},
): Record<string, any> => {
  const publicHit = stripInternalQualityFields(hit);
  if (!options.includeQualitySummary) return publicHit;

  const qualitySummary = buildResearchEntityQualitySummary({
    entity: publicHit,
    leadMembers: Array.isArray(hit._leadMembers) ? hit._leadMembers : [],
  });

  return {
    ...publicHit,
    qualitySummary,
  };
};

const profileSourceUrlsForUser = (user: Record<string, any> | null | undefined): string[] => {
  if (!user) return [];
  const profileUrls =
    user.profileUrls && typeof user.profileUrls === 'object'
      ? Object.values(user.profileUrls as Record<string, unknown>)
      : [];
  return uniqueStrings(
    [...profileUrls, user.website]
      .filter((value): value is string => typeof value === 'string')
      .filter((url) => httpUrlHasHostSuffix(url, 'yale.edu') || /(^|[/.])yale\.edu\//i.test(url)),
    4,
  );
};

async function enrichResearchHitsWithProfileFallback(hits: any[]): Promise<any[]> {
  const hitIds = hits
    .map((hit) => hit.id || hit._id)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (hitIds.length === 0) return hits;

  const memberRows: any[] = await ResearchGroupMember.find({
    researchEntityId: { $in: hitIds },
    isCurrentMember: { $ne: false },
    role: { $in: Array.from(LEAD_RESEARCH_AREA_ROLES) },
  })
    .select('researchEntityId userId role name')
    .lean();
  const userIds = memberRows
    .map((row) => row.userId)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (memberRows.length === 0 || userIds.length === 0) return hits;

  const users: any[] = await User.find({ _id: { $in: userIds } })
    .select('website profileUrls bio topics researchInterests')
    .lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const membersByEntityId = new Map<string, Array<{ role?: string; user?: any }>>();

  for (const row of memberRows) {
    const entityId = String(row.researchEntityId || '');
    const user = row.userId ? usersById.get(String(row.userId)) : null;
    if (!entityId || !user) continue;
    membersByEntityId.set(entityId, [
      ...(membersByEntityId.get(entityId) || []),
      {
        role: row.role,
        user,
      },
    ]);
  }

  return hits.map((hit) => {
    const id = String(hit.id || hit._id || '');
    const members = membersByEntityId.get(id) || [];
    if (members.length === 0) return hit;

    const profileSourceUrls = uniqueStrings(
      members.flatMap((member) => profileSourceUrlsForUser(member.user)),
      4,
    );
    const groupWithSources =
      (!Array.isArray(hit.sourceUrls) || hit.sourceUrls.length === 0) &&
      profileSourceUrls.length > 0
        ? { ...hit, sourceUrls: profileSourceUrls }
        : hit;
    const normalizedGroup = sanitizeResearchEntityDescription(
      applyProfileResearchAreaFallback(
        applyPrincipalInvestigatorWebsiteFallback(groupWithSources, members),
        members,
      ),
      members,
    );
    const profileSynthesis = textValue((normalizedGroup as any).profileSynthesisDescription).trim()
      ? {
          description: textValue((normalizedGroup as any).profileSynthesisDescription).trim(),
          source: 'PI_PROFILE_SYNTHESIS' as const,
        }
      : buildProfileSynthesisDescription(normalizedGroup, members, []);

    if (!profileSynthesis) return normalizedGroup;

    return {
      ...normalizedGroup,
      profileSynthesisDescription: profileSynthesis.description,
      descriptionSource: profileSynthesis.source,
    };
  });
}

async function searchResearchGroupsByEvidence(
  page: number,
  pageSize: number,
  options: ResearchGroupSearchOptions = {},
): Promise<ResearchGroupSearchResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const offset = (safePage - 1) * safePageSize;
  const qualitySortDirection = shouldShowLowQualityResearchFirst(options) ? 1 : -1;
  const qualityMatch = qualityFilterMatchStage(options.qualityFilters);
  const lowQualityFirst = shouldShowLowQualityResearchFirst(options);
  const pipeline: PipelineStage[] = [
    { $match: { archived: { $ne: true }, ...visibleTierMatch(options) } },
    {
      $lookup: {
        from: 'access_signals',
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$researchEntityId', '$$entityId'] },
              archived: false,
              sourceName: { $ne: 'ylabs-listing' },
              $or: [
                { derivationKey: { $exists: false } },
                { derivationKey: { $not: /^listing:/ } },
              ],
            },
          },
          {
            $project: {
              signalType: 1,
              confidence: 1,
              confidenceScore: 1,
              sourceUrl: 1,
              observedAt: 1,
            },
          },
        ],
        as: '_accessSignals',
      },
    },
    {
      $lookup: {
        from: 'entry_pathways',
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$researchEntityId', '$$entityId'] },
              archived: false,
              sourceName: { $ne: 'ylabs-listing' },
              pathwayType: { $nin: FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES },
              $or: [
                { derivationKey: { $exists: false } },
                { derivationKey: { $not: /^listing:/ } },
              ],
            },
          },
          {
            $project: {
              pathwayType: 1,
              status: 1,
              evidenceStrength: 1,
              confidence: 1,
              sourceUrls: 1,
              updatedAt: 1,
            },
          },
        ],
        as: '_entryPathways',
      },
    },
    {
      $lookup: {
        from: 'posted_opportunities',
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$researchEntityId', '$$entityId'] },
              archived: false,
              status: { $in: ['OPEN', 'ROLLING'] },
              $or: [{ listingId: { $exists: false } }, { listingId: null }],
            },
          },
          { $project: { status: 1, deadline: 1, applicationUrl: 1, sourceUrls: 1 } },
        ],
        as: '_postedOpportunities',
      },
    },
    {
      $lookup: {
        from: 'research_entity_members',
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$researchEntityId', '$$entityId'] },
              isCurrentMember: { $ne: false },
              role: { $in: Array.from(LEAD_RESEARCH_AREA_ROLES) },
            },
          },
          { $project: { role: 1, userId: 1, name: 1, sourceUrl: 1 } },
        ],
        as: '_leadMembers',
      },
    },
    {
      $addFields: {
        _sourceUrls: { $ifNull: ['$sourceUrls', []] },
        _descriptionEvidenceText: {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ['$shortDescription', ''] },
                ' ',
                { $ifNull: ['$description', ''] },
                ' ',
                { $ifNull: ['$fullDescription', ''] },
                ' ',
                { $ifNull: ['$profileSynthesisDescription', ''] },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        _sourceUrlCount: { $size: '$_sourceUrls' },
        _officialYaleSourceCount: {
          $size: {
            $filter: {
              input: '$_sourceUrls',
              as: 'url',
              cond: {
                $regexMatch: {
                  input: '$$url',
                  regex: /(^|[/.])yale\.edu/i,
                },
              },
            },
          },
        },
        _accessSignalCount: { $size: '$_accessSignals' },
        _directAccessSignalCount: {
          $size: {
            $filter: {
              input: '$_accessSignals',
              as: 'signal',
              cond: { $in: ['$$signal.signalType', DIRECT_ACCESS_SIGNAL_TYPES] },
            },
          },
        },
        _strongAccessSignalCount: {
          $size: {
            $filter: {
              input: '$_accessSignals',
              as: 'signal',
              cond: {
                $or: [
                  { $eq: ['$$signal.confidence', 'HIGH'] },
                  { $gte: [{ $ifNull: ['$$signal.confidenceScore', 0] }, 0.7] },
                ],
              },
            },
          },
        },
        _actionablePathwayCount: {
          $size: {
            $filter: {
              input: '$_entryPathways',
              as: 'pathway',
              cond: {
                $and: [
                  { $in: ['$$pathway.status', ['ACTIVE', 'RECURRING', 'PLAUSIBLE']] },
                  { $ne: ['$$pathway.evidenceStrength', 'NONE'] },
                ],
              },
            },
          },
        },
        _postedOpportunityCount: { $size: '$_postedOpportunities' },
        _leadMemberCount: { $size: '$_leadMembers' },
        _hasDescriptionEvidence: {
          $gt: [{ $strLenCP: '$_descriptionEvidenceText' }, 0],
        },
        _qualityProfileFallback: {
          $eq: ['$descriptionSource', 'PI_PROFILE_SYNTHESIS'],
        },
      },
    },
    {
      $addFields: {
        _evidenceScore: evidenceScoreExpression,
        _qualityDescriptionIssue: {
          $or: [
            { $not: ['$_hasDescriptionEvidence'] },
            { $eq: ['$descriptionSource', 'PI_PROFILE_SYNTHESIS'] },
          ],
        },
        _qualityMissingLead: { $eq: ['$_leadMemberCount', 0] },
      },
    },
    {
      $addFields: {
        _qualityRepairScore: {
          $add: [
            { $cond: ['$_qualityDescriptionIssue', 45, 0] },
            { $cond: ['$_qualityMissingLead', 35, 0] },
            { $cond: [{ $eq: ['$_sourceUrlCount', 0] }, 16, 0] },
            { $cond: ['$_qualityProfileFallback', 22, 0] },
          ],
        },
      },
    },
    ...(qualityMatch ? [qualityMatch] : []),
    {
      $sort: lowQualityFirst
        ? {
            _qualityRepairScore: -1,
            _evidenceScore: 1,
            _postedOpportunityCount: 1,
            _accessSignalCount: 1,
            _actionablePathwayCount: 1,
            _officialYaleSourceCount: 1,
            lastObservedAt: 1,
            name: 1,
            _id: 1,
          }
        : {
            _evidenceScore: qualitySortDirection,
            _postedOpportunityCount: qualitySortDirection,
            _accessSignalCount: qualitySortDirection,
            _actionablePathwayCount: qualitySortDirection,
            _officialYaleSourceCount: qualitySortDirection,
            lastObservedAt: qualitySortDirection,
            name: 1,
            _id: 1,
          },
    },
    {
      $facet: {
        data: [
          { $skip: offset },
          { $limit: safePageSize },
          {
            $project: {
              _accessSignals: 0,
              _entryPathways: 0,
              _postedOpportunities: 0,
              _sourceUrls: 0,
              _descriptionEvidenceText: 0,
              _sourceUrlCount: 0,
              _officialYaleSourceCount: 0,
              _accessSignalCount: 0,
              _directAccessSignalCount: 0,
              _strongAccessSignalCount: 0,
              _actionablePathwayCount: 0,
              _postedOpportunityCount: 0,
              _leadMemberCount: 0,
              _hasDescriptionEvidence: 0,
              _evidenceScore: 0,
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
  const [result] = await ResearchEntity.aggregate(pipeline);

  const hits = Array.isArray(result?.data) ? result.data : [];
  const estimatedTotalHits =
    Array.isArray(result?.total) && typeof result.total[0]?.count === 'number'
      ? result.total[0].count
      : hits.length;
  const hitIds = hits
    .map((hit: any) => hit.id || hit._id)
    .filter((id: any) => mongoose.Types.ObjectId.isValid(id));
  const [accessSummaries, waysInByEntityId] = await Promise.all([
    listAccessSummariesForResearchEntities(hitIds),
    listWaysInForResearchEntities(hitIds.map((id: any) => String(id))),
  ]);
  const normalizedHits = hits.map((hit: any) => {
    const id = hit.id || hit._id;
    return addQualitySummaryToHit({
      ...hit,
      _id: id,
      accessSummary: accessSummaries.get(String(id)),
      waysIn: waysInByEntityId.get(String(id)) || [],
    }, options);
  });
  const enrichedHits = await enrichResearchHitsWithProfileFallback(normalizedHits);

  return addResearchEntitySearchAliases({
    hits: enrichedHits,
    estimatedTotalHits,
    page: safePage,
    pageSize: safePageSize,
  });
}

/**
 * Hybrid Meilisearch query for ResearchEntity. Mirrors the pattern used in
 * the retired listing search: keyword-only when no query, hybrid
 * (semanticRatio 0.8) when a non-empty query is provided.
 */
export async function searchResearchGroupsViaMeili(
  query: string,
  filters: ResearchGroupFilterInput,
  page: number,
  pageSize: number,
  sort: ResearchGroupSearchSort = {},
  options: ResearchGroupSearchOptions = {},
): Promise<ResearchGroupSearchResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const offset = (safePage - 1) * safePageSize;

  const effectiveFilters: ResearchGroupFilterInput = {
    ...(filters || {}),
    ...(options.studentVisibilityTiers?.length ||
    (!options.includeSuppressed && !shouldShowLowQualityResearchFirst(options))
      ? {
          studentVisibilityTier:
            options.studentVisibilityTiers?.length
              ? options.studentVisibilityTiers
              : publicStudentVisibilityTiers,
        }
      : {}),
  };
  const filterString = buildResearchGroupFilterString(effectiveFilters);

  const trimmedQuery = (query || '').trim();
  if (trimmedQuery === '' && !sort.sortBy && !hasResearchGroupFilters(filters || {})) {
    return searchResearchGroupsByEvidence(safePage, safePageSize, options);
  }

  const sortConfig: string[] = [];
  if (sort.sortBy) {
    const order = sort.sortOrder === 'asc' ? 'asc' : 'desc';
    sortConfig.push(`${sort.sortBy}:${order}`);
  } else if (trimmedQuery === '') {
    sortConfig.push('lastObservedAt:desc');
  }

  const candidateLimit =
    trimmedQuery !== '' && sortConfig.length === 0
      ? Math.min(MAX_PAGE_SIZE, safePageSize * CANDIDATE_MULTIPLIER)
      : safePageSize;
  const usesMergedExploratorySearch = trimmedQuery !== '' && sortConfig.length === 0;

  const baseSearchParams: Record<string, any> = {
    filter: filterString,
    limit: candidateLimit,
    offset: usesMergedExploratorySearch ? 0 : offset,
  };
  if (sortConfig.length > 0) {
    baseSearchParams.sort = sortConfig;
  }

  const index = await getMeiliIndex('researchentities');
  const querySemantics = buildResearchSearchQuerySemantics(trimmedQuery);
  const searchQueries = usesMergedExploratorySearch
    ? querySemantics.expansionQueries
    : [trimmedQuery];
  const normalizedOriginalQuery = normalizeSearchText(trimmedQuery);
  const searchParamsForKeywordQuery = (searchQuery: string): Record<string, any> => {
    const params: Record<string, any> = {
      ...baseSearchParams,
      showRankingScore: true,
      showRankingScoreDetails: true,
    };
    if (normalizedOriginalQuery && normalizeSearchText(searchQuery) === normalizedOriginalQuery) {
      params.matchingStrategy = 'all';
    }
    return params;
  };

  const searchResults: Array<{ hits?: any[]; estimatedTotalHits?: number }> = [];
  let searchMode: ResearchSearchMode = trimmedQuery === '' ? 'keyword' : 'expanded-keyword';
  let originalQuerySearched = false;
  const semanticSearchEnabled =
    trimmedQuery !== '' &&
    process.env.RESEARCH_SEARCH_SEMANTIC === 'true' &&
    Boolean(process.env.OPENAI_API_KEY);

  if (semanticSearchEnabled) {
    try {
      const hybridParams = {
        ...baseSearchParams,
        showRankingScore: true,
        showRankingScoreDetails: true,
        hybrid: {
          semanticRatio: 0.65,
          embedder: 'default',
        },
      };
      searchResults.push(await index.search(trimmedQuery, hybridParams));
      searchMode = 'hybrid';
      originalQuerySearched = true;
    } catch (error) {
      if (!isMissingMeiliEmbedderError(error)) {
        throw error;
      }

      searchResults.push(
        await index.search(trimmedQuery, searchParamsForKeywordQuery(trimmedQuery)),
      );
      searchMode = 'expanded-keyword';
      originalQuerySearched = true;
    }
  }

  const keywordQueries = searchQueries.filter((searchQuery) => {
    if (!originalQuerySearched) return true;
    return normalizeSearchText(searchQuery) !== normalizeSearchText(trimmedQuery);
  });
  searchResults.push(
    ...(await Promise.all(
      keywordQueries.map((searchQuery) =>
        index.search(searchQuery, searchParamsForKeywordQuery(searchQuery)),
      ),
    )),
  );

  const mergedHits = dedupeResearchHits(searchResults.flatMap((result) => result?.hits || []));
  const rankedHitRecords =
    trimmedQuery === ''
      ? mergedHits.map((hit) => ({ hit }))
      : rankResearchEntityCandidates(mergedHits, querySemantics, searchMode).map(
          ({ candidate, searchMatch }) => ({ hit: candidate, searchMatch }),
        );
  const hitRecords = usesMergedExploratorySearch
    ? rankedHitRecords.slice(offset, offset + safePageSize)
    : rankedHitRecords;
  const estimatedTotalHits = usesMergedExploratorySearch
    ? rankedHitRecords.length
    : searchQueries.length === 1
      ? searchResults[0]?.estimatedTotalHits
      : Math.max(
          mergedHits.length,
          ...searchResults.map((result) => result?.estimatedTotalHits || 0),
        );

  const hitIds = hitRecords
    .map(({ hit }: any) => hit.id || hit._id)
    .filter((id: any) => mongoose.Types.ObjectId.isValid(id));
  const [activeEntities, accessSummaries, waysInByEntityId] = await Promise.all([
    ResearchEntity.find({ _id: { $in: hitIds }, archived: { $ne: true } }).lean(),
    listAccessSummariesForResearchEntities(hitIds),
    listWaysInForResearchEntities(hitIds.map((id: any) => String(id))),
  ]);
  const activeEntityById = new Map(
    activeEntities.map((entity: any) => [String(entity._id), entity]),
  );
  // Map Meilisearch's `id` back to `_id` for client compatibility, but use
  // Mongo as the source of truth so stale index rows cannot link to dead slugs.
  const normalizedHits = hitRecords.flatMap(({ hit, searchMatch }: any) => {
    const id = hit.id || hit._id;
    const activeEntity = activeEntityById.get(String(id));
    if (!activeEntity) return [];
    return {
      ...hit,
      ...activeEntity,
      _id: id,
      accessSummary: accessSummaries.get(String(id)),
      waysIn: waysInByEntityId.get(String(id)) || [],
      ...(searchMatch ? { searchMatch } : {}),
    };
  });
  const enrichedHits = await enrichResearchHitsWithProfileFallback(normalizedHits);

  return addResearchEntitySearchAliases({
    hits: enrichedHits,
    estimatedTotalHits: estimatedTotalHits ?? enrichedHits.length,
    page: safePage,
    pageSize: safePageSize,
  });
}

const PUBLIC_USER_FIELDS =
  'netid fname lname imageUrl primaryDepartment title secondaryDepartments bio researchInterests topics website';

const normalizedComparableText = (value: unknown): string =>
  textValue(value).replace(/\s+/g, ' ').trim().toLowerCase();

const redactPublicText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

function isCopiedProfileBioText(value: unknown, copiedBioTexts: Set<string>): boolean {
  const normalized = normalizedComparableText(value);
  if (!normalized) return false;
  for (const bio of copiedBioTexts) {
    if (normalized === bio) return true;
    if (bio.length > 0 && bio.startsWith(normalized)) return true;
  }
  return false;
}

function uniqueProfileResearchAreas(
  members: Array<{ user?: Record<string, any> | null; role?: string }>,
): string[] {
  return publicResearchAreaArray(
    members
      .filter((member) => LEAD_RESEARCH_AREA_ROLES.has(member.role || ''))
      .flatMap((member) => [
        ...(Array.isArray(member.user?.topics) ? member.user?.topics : []),
        ...(Array.isArray(member.user?.researchInterests) ? member.user?.researchInterests : []),
      ]),
  );
}

export function applyProfileResearchAreaFallback<T extends Record<string, any>>(
  group: T,
  members: Array<{ user?: Record<string, any> | null; role?: string }>,
): T & {
  researchAreas: string[];
  profileResearchAreas?: string[];
  researchAreaSource?: 'PI_PROFILE_FALLBACK';
} {
  const entityAreas = publicResearchAreaArray(group.researchAreas);
  const profileAreas = uniqueProfileResearchAreas(members);
  if (profileAreas.length === 0) {
    return {
      ...group,
      researchAreas: entityAreas,
    };
  }

  const profileKeys = new Set(profileAreas.map((area) => area.toLowerCase()));
  const entityAreasAreOnlyProfileTerms =
    entityAreas.length === 0 || entityAreas.every((area) => profileKeys.has(area.toLowerCase()));

  if (!entityAreasAreOnlyProfileTerms) {
    return {
      ...group,
      researchAreas: entityAreas,
    };
  }

  return {
    ...group,
    researchAreas: [],
    profileResearchAreas: profileAreas,
    researchAreaSource: 'PI_PROFILE_FALLBACK',
  };
}

export function applyPrincipalInvestigatorWebsiteFallback<T extends Record<string, any>>(
  group: T,
  members: Array<{ user?: Record<string, any> | null; role?: string }>,
): T {
  if (isUsableResearchWebsiteUrl(group.websiteUrl) || isUsableResearchWebsiteUrl(group.website)) {
    return group;
  }

  const piWebsite = firstUsableResearchWebsiteUrl(
    members
      .filter((member) => LEAD_RESEARCH_AREA_ROLES.has(member.role || ''))
      .map((member) => member.user?.website),
  );

  return piWebsite ? { ...group, websiteUrl: piWebsite } : group;
}

export function sanitizeResearchEntityDescription<T extends Record<string, any>>(
  group: T,
  members: Array<{ user?: Record<string, any> | null; role?: string }>,
): T {
  const publicSanitizedGroup = sanitizeResearchEntityPublicDescriptionFields(group);
  const copiedBioTexts = new Set(
    members.map((member) => normalizedComparableText(member.user?.bio)).filter(Boolean),
  );
  const descriptionIsCopiedProfileBio = isCopiedProfileBioText(group.description, copiedBioTexts);

  if (!descriptionIsCopiedProfileBio) {
    return publicSanitizedGroup;
  }

  const entityDescriptionText = [
    publicSanitizedGroup.shortDescription,
    publicSanitizedGroup.description,
    publicSanitizedGroup.fullDescription,
  ]
    .map((value) => publicResearchEntityDescriptionText(value))
    .join(' ');
  if (/\b(?:my|our|this)\s+lab\b/i.test(entityDescriptionText)) {
    return publicSanitizedGroup;
  }

  const replacement = [publicSanitizedGroup.shortDescription, publicSanitizedGroup.fullDescription]
    .map((value) => publicResearchEntityDescriptionText(value))
    .find((value) => value && !isCopiedProfileBioText(value, copiedBioTexts));

  return {
    ...publicSanitizedGroup,
    description: replacement || '',
    shortDescription: isCopiedProfileBioText(publicSanitizedGroup.shortDescription, copiedBioTexts)
      ? ''
      : publicSanitizedGroup.shortDescription,
    fullDescription: isCopiedProfileBioText(publicSanitizedGroup.fullDescription, copiedBioTexts)
      ? ''
      : publicSanitizedGroup.fullDescription,
  };
}

export function buildProfileSynthesisDescription(
  group: Record<string, any>,
  members: Array<{ user?: Record<string, any> | null; role?: string }>,
  scholarlyLinks: Array<{ title?: unknown }> = [],
): { description: string; source: 'PI_PROFILE_SYNTHESIS' } | null {
  const existingDescription = [group.shortDescription, group.description, group.fullDescription]
    .map((value) => publicResearchEntityDescriptionText(value))
    .find(Boolean);

  if (existingDescription) return null;

  const normalizeProfileBioContext = (value: string): string => {
    const compact = value.replace(/\s+/g, ' ').trim();
    const bioHeading = compact.search(/\bBio\b/i);
    if (bioHeading > 40 && bioHeading < 220) {
      return compact
        .slice(bioHeading)
        .replace(/^Bio\b\s*/i, '')
        .trim();
    }
    return compact.replace(/\bHighlighted\b\s*$/i, '').trim();
  };
  const profileBio = members
    .map((member) =>
      normalizeProfileBioContext(publicResearchEntityDescriptionText(member.user?.bio)),
    )
    .find(Boolean);
  const isResearchFocusedProfileSentence = (value: string): boolean =>
    /\b(research|scholarly work|ethnograph|books? explore|explores?|documentary|film|chronicles|examines|studies|tracks|investigates)\b/i.test(
      value,
    ) && !/\b(?:my courses are conducted|i presently teach|honors?|award)\b/i.test(value);
  const profileBioSentences = (value: string): string[] => {
    const abbreviationToken = '<ABBR_PERIOD>';
    const protectedValue = value.replace(/\b(?:Dr|Prof|Mr|Mrs|Ms|St|Jr|Sr)\./g, (match) =>
      match.replace('.', abbreviationToken),
    );
    return (
      protectedValue
        .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
        ?.map((sentence) =>
          sentence.replace(new RegExp(abbreviationToken, 'g'), '.').replace(/\s+/g, ' ').trim(),
        )
        .filter((sentence) => sentence && !/^(?:Dr|Prof|Mr|Mrs|Ms|St|Jr|Sr)\.$/.test(sentence)) ||
      []
    );
  };
  const summarizeProfileBio = (value: string): string => {
    const sentences = profileBioSentences(value);
    if (sentences.length === 0) return value.replace(/\s+/g, ' ').trim();

    const selectedIndexes = new Set<number>([0]);
    const currentResearchIndex = sentences.findIndex(
      (sentence, index) => index > 0 && /\bcurrent research\b/i.test(sentence),
    );
    if (currentResearchIndex > 0) {
      selectedIndexes.add(currentResearchIndex);
    }

    for (let index = 1; index < sentences.length && selectedIndexes.size < 3; index += 1) {
      if (selectedIndexes.has(index)) continue;
      if (isResearchFocusedProfileSentence(sentences[index])) {
        selectedIndexes.add(index);
      }
    }

    const selected = [...selectedIndexes].sort((a, b) => a - b).map((index) => sentences[index]);
    const summary = selected.join(' ').trim();
    if (summary.length <= 900) return summary;

    const bounded: string[] = [];
    for (const sentence of selected) {
      const candidate = [...bounded, sentence].join(' ');
      if (candidate.length > 900 && bounded.length > 0) break;
      bounded.push(sentence);
    }
    return bounded.join(' ').trim() || selected[0];
  };
  const profileBioSummary = profileBio ? summarizeProfileBio(profileBio) : '';
  const entityTopics = uniqueStrings(
    [
      ...publicResearchAreaArray(group.profileResearchAreas),
      ...publicResearchAreaArray(group.researchAreas),
    ],
    5,
  );
  const topics =
    entityTopics.length > 0 ? entityTopics : uniqueProfileResearchAreas(members).slice(0, 5);
  const paperTitles = uniqueStrings(
    scholarlyLinks
      .map((paper) => textValue(paper.title).replace(/\s+/g, ' ').trim())
      .filter((title) => title && !isResearchEntitySourceChromeText(title)),
    3,
  );

  if (topics.length === 0 && paperTitles.length === 0 && !profileBioSummary) return null;

  const topicSentence = topics.length > 0 ? ` It appears to center on ${topics.join(', ')}.` : '';
  const paperSentence =
    paperTitles.length > 0 ? ` Recent research activity includes ${paperTitles.join('; ')}.` : '';
  if (profileBioSummary) {
    return {
      source: 'PI_PROFILE_SYNTHESIS',
      description: profileBioSummary,
    };
  }

  return {
    source: 'PI_PROFILE_SYNTHESIS',
    description: `${topicSentence}${paperSentence}`.trim(),
  };
}

export function selectVisibleResearchEntityMemberRows(memberRows: any[]): any[] {
  const visibleRows = memberRows.filter((row) => row?.isCurrentMember !== false);
  const byUserRole = new Map<string, any>();

  for (const row of visibleRows) {
    const userId = row.userId ? String(row.userId) : '';
    const name = textValue(row.name).trim().toLowerCase();
    const identityKey = userId ? `user:${userId}` : name ? `name:${name}` : '';
    if (!identityKey) continue;
    const key = `${identityKey}:${row.role || ''}`;
    if (!byUserRole.has(key)) {
      byUserRole.set(key, row);
    }
  }

  return Array.from(byUserRole.values());
}

export function sortEntryPathwaysByQuality(entryPathways: any[]): any[] {
  return [...entryPathways].sort((a, b) => {
    const qualityA = computePathwayQuality(a);
    const qualityB = computePathwayQuality(b);
    if (qualityA.qualityScore !== qualityB.qualityScore) {
      return qualityB.qualityScore - qualityA.qualityScore;
    }
    if (qualityA.evidenceCount !== qualityB.evidenceCount) {
      return qualityB.evidenceCount - qualityA.evidenceCount;
    }
    return (
      new Date(b.lastObservedAt || b.createdAt || 0).getTime() -
      new Date(a.lastObservedAt || a.createdAt || 0).getTime()
    );
  });
}

/**
 * Detail payload for the lab page: the group itself, member User snapshots
 * (PIs first), recent scholarly links, and pathway/access summaries.
 */
export async function getResearchGroupDetail(
  slug: string,
  options: { includeQualitySummary?: boolean } = {},
): Promise<{
  researchEntity: PublicResearchEntityDto;
  members: Array<{ user: any; role: string }>;
  researchActivityLinks: any[];
  scholarlyLinks: any[];
  memberScholarlyLinks: any[];
  recentPapers: any[];
  recentArxivPreprints: any[];
  activeListings: any[];
  entryPathways: any[];
  accessSignals: any[];
  contactRoutes: any[];
  postedOpportunities: any[];
  entityRelationships: any[];
  relatedResearchEntities: any[];
  affiliatedRelationships: any[];
  affiliatedResearchEntities: any[];
} | null> {
  const group = await ResearchEntity.findOne({ slug, archived: { $ne: true } }).lean();
  if (!group) return null;

  const memberRows: any[] = selectVisibleResearchEntityMemberRows(
    await ResearchGroupMember.find({
      researchEntityId: (group as any)._id,
      isCurrentMember: { $ne: false },
    }).lean(),
  );

  const memberUserIds = memberRows
    .map((row) => row.userId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);

  const users: any[] = memberUserIds.length
    ? await User.find({ _id: { $in: memberUserIds } }, PUBLIC_USER_FIELDS).lean()
    : [];

  const usersById = new Map<string, any>(users.map((u) => [String(u._id), u]));

  const ROLE_PRIORITY: Record<string, number> = {
    pi: 0,
    'co-pi': 1,
    director: 2,
    'co-director': 3,
    'core-faculty': 4,
    affiliated: 5,
    alumni: 6,
  };

  const members = memberRows
    .map((row) => {
      const linkedUser = row.userId ? usersById.get(String(row.userId)) : null;
      const nameOnly = textValue(row.name).trim();
      const fallbackUser = nameOnly
        ? {
            _id: `member:${row._id || nameOnly}`,
            netid: '',
            fname: nameOnly,
            lname: '',
            displayName: nameOnly,
            title: row.role === 'pi' ? 'Principal Investigator' : '',
          }
        : null;
      return {
        user: linkedUser || fallbackUser,
        role: row.role,
      };
    })
    .filter((m) => m.user !== null)
    .map((m) => ({
      ...m,
      user: {
        ...m.user,
        image_url: m.user.imageUrl || m.user.image_url,
        primary_department: m.user.primaryDepartment || m.user.primary_department,
      },
    }))
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));

  const [
    scholarlyLinks,
    memberScholarlyLinks,
    entryPathwaysRaw,
    accessSignals,
    contactRoutes,
    postedOpportunities,
    accessSummary,
    relatedResearchEntitiesPayload,
    affiliatedResearchEntitiesPayload,
  ] = await Promise.all([
    listPublicScholarlyLinksForResearchEntity((group as any)._id, memberUserIds),
    listPublicMemberScholarlyLinks(memberUserIds, 3),
    EntryPathway.find({ researchEntityId: (group as any)._id, archived: false }).lean(),
    AccessSignal.find({ researchEntityId: (group as any)._id, archived: false })
      .sort({ observedAt: -1 })
      .lean(),
    ContactRoute.find(
      {
        researchEntityId: (group as any)._id,
        archived: false,
        visibility: 'PUBLIC',
      },
      'routeType label url priority visibility contactPolicy rationale sourceUrl observedAt',
    )
      .sort({ priority: 1 })
      .lean(),
    PostedOpportunity.find({ researchEntityId: (group as any)._id, archived: false })
      .sort({ deadline: 1 })
      .lean(),
    getAccessSummaryForResearchEntity((group as any)._id),
    listRelatedResearchEntitiesForDetail(String((group as any)._id)),
    listAffiliatedResearchEntitiesForDetail(String((group as any)._id)),
  ]);

  const entryPathways = sortEntryPathwaysByQuality(entryPathwaysRaw).map((pathway) => ({
    ...pathway,
    studentFacingLabel: redactPublicText(pathway.studentFacingLabel) || pathway.studentFacingLabel,
    explanation: redactPublicText(pathway.explanation) || pathway.explanation,
    bestNextStep: redactPublicText(pathway.bestNextStep) || pathway.bestNextStep,
    sourceUrls: publicSourceUrls(pathway.sourceUrls),
  }));
  const publicAccessSignals = accessSignals.map((signal) => ({
    ...signal,
    excerpt: redactPublicText(signal.excerpt) || signal.excerpt,
    sourceUrl: publicSourceUrl(signal.sourceUrl),
  }));
  const publicContactRoutes = contactRoutes
    .map((route) => ({
      ...route,
      label: redactPublicText(route.label) || route.label,
      rationale: redactPublicText(route.rationale) || route.rationale,
      blockedPublicUrl: Boolean(route.url) && !publicSourceUrl(route.url),
      url: publicSourceUrl(route.url),
      sourceUrl: publicSourceUrl(route.sourceUrl),
    }))
    .filter((route) => !route.blockedPublicUrl)
    .map(({ blockedPublicUrl: _blockedPublicUrl, ...route }) => route);
  const publicPostedOpportunities = postedOpportunities.map((opportunity) => ({
    ...opportunity,
    applicationUrl: publicSourceUrl(opportunity.applicationUrl),
    sourceUrls: publicSourceUrls(opportunity.sourceUrls),
  }));
  const publicMembers = members.map((member) => {
    const {
      bio: _bio,
      researchInterests: _researchInterests,
      topics: _topics,
      ...user
    } = member.user;
    return {
      ...member,
      user,
    };
  });
  const normalizedGroup = sanitizeResearchEntityDescription(
    applyProfileResearchAreaFallback(
      applyPrincipalInvestigatorWebsiteFallback(
        {
          ...group,
          accessSummary,
        },
        members,
      ),
      members,
    ),
    members,
  );
  const profileSynthesis = textValue((normalizedGroup as any).profileSynthesisDescription).trim()
    ? {
        description: textValue((normalizedGroup as any).profileSynthesisDescription).trim(),
        source: 'PI_PROFILE_SYNTHESIS' as const,
      }
    : buildProfileSynthesisDescription(normalizedGroup, members, scholarlyLinks);
  const researchActivityLinks = [
    ...scholarlyLinks.map((link) =>
      withResearchActivityRelationship(link, {
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
        researchEntityId: String((group as any)._id),
      }),
    ),
    ...memberScholarlyLinks.map((link) =>
      withResearchActivityRelationship(link, {
        relationshipBasis: 'member_authorship',
        evidenceLabel: 'Authored by a listed professor',
      }),
    ),
  ];
  const detailGroup = profileSynthesis
    ? {
        ...normalizedGroup,
        profileSynthesisDescription: profileSynthesis.description,
        descriptionSource: profileSynthesis.source,
      }
    : {
        ...normalizedGroup,
        descriptionSource:
          publicResearchEntityDescriptionText((normalizedGroup as any).description) ||
          publicResearchEntityDescriptionText((normalizedGroup as any).shortDescription) ||
          publicResearchEntityDescriptionText((normalizedGroup as any).fullDescription)
          ? 'ENTITY_SOURCE'
          : (normalizedGroup as any).descriptionSource || 'NONE',
      };
  const detailResearchEntity = options.includeQualitySummary
    ? {
        ...detailGroup,
        qualitySummary: buildResearchEntityQualitySummary({
          entity: detailGroup,
          leadMembers: members.filter((member) => LEAD_RESEARCH_AREA_ROLES.has(member.role)),
        }),
      }
    : detailGroup;

  return addResearchEntityDetailAlias({
    group: detailResearchEntity,
    members: publicMembers,
    researchActivityLinks,
    scholarlyLinks,
    memberScholarlyLinks,
    recentPapers: [],
    recentArxivPreprints: [],
    activeListings: [],
    entryPathways,
    accessSignals: publicAccessSignals,
    contactRoutes: publicContactRoutes,
    postedOpportunities: publicPostedOpportunities,
    entityRelationships: relatedResearchEntitiesPayload.relationships,
    relatedResearchEntities: relatedResearchEntitiesPayload.relatedResearchEntities,
    affiliatedRelationships: affiliatedResearchEntitiesPayload.relationships,
    affiliatedResearchEntities: affiliatedResearchEntitiesPayload.relatedResearchEntities,
  });
}
