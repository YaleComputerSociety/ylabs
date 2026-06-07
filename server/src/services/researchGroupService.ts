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
import { getMeiliIndex } from '../utils/meiliClient';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  getAccessSummaryForResearchEntity,
  listAccessSummariesForResearchEntities,
} from './accessSummaryService';
import {
  buildResearchGroupFilterString,
  ResearchGroupFilterInput,
} from './researchGroupFilters';
import {
  buildResearchEntityQualitySummary,
  type ResearchEntityQualitySummary,
} from './researchEntityQuality';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  type PublicResearchEntityDto,
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
import { publicContactEmail } from '../utils/contactEmail';
import { redactDirectContactInfo } from '../utils/contactRedaction';

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
}

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

  if (owner._id && mongoose.Types.ObjectId.isValid(owner._id)) {
    const existingMember = await ResearchGroupMember.findOne({
      userId: owner._id,
      role: 'pi',
    }).lean();
    if (existingMember) {
      const group = await ResearchEntity.findById(
        (existingMember as any).researchEntityId || (existingMember as any).researchGroupId,
      ).lean();
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

  if (owner._id && mongoose.Types.ObjectId.isValid(owner._id)) {
    await ResearchGroupMember.updateOne(
      { researchEntityId: group._id, userId: owner._id },
      {
        $setOnInsert: {
          researchEntityId: group._id,
          researchGroupId: group._id,
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
  return ResearchEntity.findOne({
    slug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();
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
  includeNonPublic?: boolean;
  lowQualityFirst?: boolean;
  qualityFilters?: ResearchGroupQualityFilter[];
}

export interface ResearchGroupSearchResult {
  researchEntities: PublicResearchEntityDto[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1000;

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
    const key = String(member.researchEntityId || member.researchGroupId || '');
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
      leadMembers: leadMembersByEntityId.get(String(entity._id)) || [],
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
  const safePage = Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const offset = (safePage - 1) * safePageSize;

  const filterString = buildResearchGroupFilterString(filters || {});

  const trimmedQuery = (query || '').trim();
  if (trimmedQuery === '' && options.lowQualityFirst) {
    const candidates = await ResearchEntity.find(
      mongoFilterFromResearchFilters(filters || {}, options.includeNonPublic),
    ).lean();
    const candidatesWithQuality = await withQualitySummaries(candidates as any[]);
    const filteredCandidates = candidatesWithQuality
      .filter((entity) => matchesQualityFilters(entity.qualitySummary, options.qualityFilters))
      .sort((a, b) => {
        const scoreDiff = b.qualitySummary.score - a.qualitySummary.score;
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || ''));
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
    const activeListingGroupIdSet = new Set(activeListingGroupIds.map((id: any) => String(id)));
    const accessSummaries = await listAccessSummariesForResearchEntities(pageEntityIds);
    return addResearchEntitySearchAliases({
      hits: pageEntities.map((entity) => ({
        ...entity,
        _id: String(entity._id),
        hasActiveListing: activeListingGroupIdSet.has(String(entity._id)),
        accessSummary: accessSummaries.get(String(entity._id)),
      })),
      estimatedTotalHits: filteredCandidates.length,
      page: safePage,
      pageSize: safePageSize,
    });
  }

  const sortConfig: string[] = [];
  if (sort.sortBy) {
    const order = sort.sortOrder === 'asc' ? 'asc' : 'desc';
    sortConfig.push(`${sort.sortBy}:${order}`);
  } else if (trimmedQuery === '') {
    sortConfig.push('lastObservedAt:desc');
  }

  const searchParams: Record<string, any> = {
    filter: filterString,
    limit: safePageSize,
    offset,
  };
  if (sortConfig.length > 0) {
    searchParams.sort = sortConfig;
  }
  if (trimmedQuery !== '') {
    searchParams.hybrid = {
      semanticRatio: 0.8,
      embedder: 'default',
    };
  }

  const index = await getMeiliIndex('researchentities');
  let searchResult: { hits?: any[]; estimatedTotalHits?: number };
  try {
    searchResult = await index.search(trimmedQuery, searchParams);
  } catch (error) {
    if (!searchParams.hybrid || !isMissingMeiliEmbedderError(error)) {
      throw error;
    }

    const keywordOnlyParams = { ...searchParams };
    delete keywordOnlyParams.hybrid;
    searchResult = await index.search(trimmedQuery, keywordOnlyParams);
  }
  const { hits, estimatedTotalHits } = searchResult;

  const hitIds = (hits || [])
    .map((hit: any) => hit.id || hit._id)
    .filter((id: any) => mongoose.Types.ObjectId.isValid(id));
  const visibleEntities =
    hitIds.length > 0
      ? await ResearchEntity.find({
          _id: { $in: hitIds },
          archived: { $ne: true },
          ...mongoVisibilityFilter(filters || {}, options.includeNonPublic),
        }).lean()
      : [];
  const visibleEntitiesById = new Map(
    (visibleEntities as any[]).map((entity) => [String(entity._id), entity]),
  );
  const visibleHitIds = hitIds.filter((id: any) => visibleEntitiesById.has(String(id)));
  const activeListingGroupIds =
    visibleHitIds.length > 0
      ? await Listing.distinct('researchEntityId', {
          researchEntityId: { $in: visibleHitIds },
          archived: false,
        })
      : [];
  const activeListingGroupIdSet = new Set(activeListingGroupIds.map((id: any) => String(id)));

  // Map Meilisearch's `id` back to `_id` for client backward compatibility.
  const accessSummaries = await listAccessSummariesForResearchEntities(visibleHitIds);
  const normalizedHits = (hits || []).flatMap((hit: any) => {
    const id = hit.id || hit._id;
    const entity = visibleEntitiesById.get(String(id));
    if (!entity) return [];
    return {
      ...entity,
      _id: id,
      hasActiveListing: activeListingGroupIdSet.has(String(id)),
      accessSummary: accessSummaries.get(String(id)),
      ...(hit.searchMatch ? { searchMatch: hit.searchMatch } : {}),
    };
  });

  return addResearchEntitySearchAliases({
    hits: normalizedHits,
    estimatedTotalHits: estimatedTotalHits ?? normalizedHits.length,
    page: safePage,
    pageSize: safePageSize,
  });
}

const PUBLIC_USER_FIELDS =
  'netid email fname lname imageUrl primaryDepartment title secondaryDepartments facultyMemberId profileUrls';

function publicMemberUserFromFaculty(faculty: any): any | null {
  if (!faculty) return null;
  const [fallbackFirstName = '', ...rest] = String(faculty.name || '').trim().split(/\s+/);
  const fallbackLastName = rest.join(' ');
  return {
    _id: faculty.userId || faculty._id,
    netid: faculty.netid,
    fname: faculty.firstName || fallbackFirstName,
    lname: faculty.lastName || fallbackLastName,
    imageUrl: faculty.photoUrl,
    image_url: faculty.photoUrl,
    primaryDepartment: faculty.primarySchool || '',
    primary_department: faculty.primarySchool || '',
    title: faculty.title || faculty.bio || '',
    email: faculty.email,
    websiteUrl: faculty.websiteUrl,
    profileUrls: faculty.profileUrls,
  };
}

const addPublicMemberField = (target: Record<string, any>, key: string, value: any) => {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
};

function publicMemberUserForResearchDetail(user: any): any {
  const publicUser: Record<string, any> = {};
  const imageUrl = user?.imageUrl || user?.image_url || '';
  const primaryDepartment = user?.primaryDepartment || user?.primary_department || '';

  addPublicMemberField(publicUser, '_id', user?._id);
  addPublicMemberField(publicUser, 'netid', user?.netid);
  addPublicMemberField(publicUser, 'fname', user?.fname);
  addPublicMemberField(publicUser, 'lname', user?.lname);
  addPublicMemberField(publicUser, 'displayName', user?.displayName);
  addPublicMemberField(publicUser, 'title', user?.title);
  publicUser.imageUrl = imageUrl;
  publicUser.image_url = imageUrl;
  addPublicMemberField(publicUser, 'primaryDepartment', primaryDepartment);
  addPublicMemberField(publicUser, 'primary_department', primaryDepartment);

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
    return { ...member, user: { ...member.user, imageUrl: publicImageUrl, image_url: publicImageUrl } };
  });
}

export function publicMemberUserForRow(
  row: any,
  usersById: Map<string, any>,
  facultyMembersById: Map<string, any>,
): any | null {
  const user = row.userId ? usersById.get(String(row.userId)) || null : null;
  const faculty = row.facultyMemberId
    ? facultyMembersById.get(String(row.facultyMemberId)) || null
    : null;
  const userFacultyId = user?.facultyMemberId ? String(user.facultyMemberId) : '';
  const rowFacultyId = row.facultyMemberId ? String(row.facultyMemberId) : '';

  if (faculty && (!user || (userFacultyId && userFacultyId !== rowFacultyId))) {
    return publicMemberUserFromFaculty(faculty);
  }

  return publicMemberUserForResearchDetail(user);
}

const PUBLIC_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

const idEquals = (left: unknown, right: unknown): boolean => String(left || '') === String(right || '');

export const currentResearchEntityMemberFilter = (researchEntityId: unknown) => ({
  researchEntityId,
  archived: { $ne: true },
  isCurrentMember: { $ne: false },
});

const publicRelationshipForResearchDetail = (relationship: any) => ({
  _id: relationship._id,
  sourceResearchEntityId: relationship.sourceResearchEntityId,
  targetResearchEntityId: relationship.targetResearchEntityId,
  relationshipType: relationship.relationshipType,
  label: relationship.label,
  evidenceStrength: relationship.evidenceStrength,
  sourceUrl: publicHttpUrl(relationship.sourceUrl),
  confidence: relationship.confidence,
  lastObservedAt: relationship.lastObservedAt,
});

export async function listResearchEntityRelationshipPayload(entityId: unknown): Promise<{
  entityRelationships: any[];
  relatedResearchEntities: PublicResearchEntityDto[];
  affiliatedRelationships: any[];
  affiliatedResearchEntities: PublicResearchEntityDto[];
}> {
  if (!mongoose.Types.ObjectId.isValid(String(entityId || ''))) {
    return {
      entityRelationships: [],
      relatedResearchEntities: [],
      affiliatedRelationships: [],
      affiliatedResearchEntities: [],
    };
  }

  const relationships = await ResearchEntityRelationship.find({
    archived: { $ne: true },
    $or: [{ sourceResearchEntityId: entityId }, { targetResearchEntityId: entityId }],
  }).lean();

  const relatedRelationships = (relationships as any[]).filter((relationship) =>
    idEquals(relationship.sourceResearchEntityId, entityId),
  );
  const affiliatedRelationships = (relationships as any[]).filter((relationship) =>
    idEquals(relationship.targetResearchEntityId, entityId),
  );
  const relatedEntityIds = relatedRelationships.map((relationship) => relationship.targetResearchEntityId);
  const affiliatedEntityIds = affiliatedRelationships.map(
    (relationship) => relationship.sourceResearchEntityId,
  );
  const entityIds = Array.from(
    new Set([...relatedEntityIds, ...affiliatedEntityIds].map((id) => String(id || '')).filter(Boolean)),
  );

  const relatedEntities =
    entityIds.length > 0
      ? await ResearchEntity.find({
          _id: { $in: entityIds },
          archived: { $ne: true },
          studentVisibilityTier: { $in: publicStudentVisibilityTiers },
        }).lean()
      : [];
  const publicRelatedEntities = (relatedEntities as any[]).filter((entity) =>
    publicStudentVisibilityTiers.includes(entity.studentVisibilityTier),
  );

  const publicEntitiesById = new Map(
    addResearchEntitySearchAliases({
      hits: publicRelatedEntities.map((entity) =>
        sanitizeResearchEntityPublicDescriptionFields(entity),
      ),
      estimatedTotalHits: publicRelatedEntities.length,
      page: 1,
      pageSize: Math.max(1, publicRelatedEntities.length),
    }).researchEntities.map((entity) => [String(entity._id || entity.id), entity]),
  );

  return {
    entityRelationships: relatedRelationships
      .filter((relationship) => publicEntitiesById.has(String(relationship.targetResearchEntityId)))
      .map(publicRelationshipForResearchDetail),
    relatedResearchEntities: relatedEntityIds
      .map((id) => publicEntitiesById.get(String(id)))
      .filter((entity): entity is PublicResearchEntityDto => Boolean(entity)),
    affiliatedRelationships: affiliatedRelationships
      .filter((relationship) => publicEntitiesById.has(String(relationship.sourceResearchEntityId)))
      .map(publicRelationshipForResearchDetail),
    affiliatedResearchEntities: affiliatedEntityIds
      .map((id) => publicEntitiesById.get(String(id)))
      .filter((entity): entity is PublicResearchEntityDto => Boolean(entity)),
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
    Object.entries(value as Record<string, unknown>).filter(
      ([, url]) => typeof url === 'string' && /^https?:\/\//i.test(url.trim()),
    ),
  ) as Record<string, string>;
};

const isLikelyOfficialPersonProfileUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return false;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathSegments = parsed.pathname
      .toLowerCase()
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const isYaleOwned = host === 'yale.edu' || host.endsWith('.yale.edu') || host === 'yalies.io';
    if (!isYaleOwned) return false;
    if (host === 'yalies.io') return true;

    const genericPersonPathSegments = new Set([
      'directory',
      'directories',
      'faculty',
      'faculty-directory',
      'members',
      'people',
      'profiles',
      'staff',
    ]);
    const hasSpecificTrailingSegment = (label: string) => {
      const index = pathSegments.indexOf(label);
      if (index < 0) return false;
      const nextSegment = pathSegments[index + 1] || '';
      return Boolean(nextSegment) && !genericPersonPathSegments.has(nextSegment);
    };

    return (
      hasSpecificTrailingSegment('profile') ||
      hasSpecificTrailingSegment('people') ||
      hasSpecificTrailingSegment('person') ||
      hasSpecificTrailingSegment('faculty') ||
      hasSpecificTrailingSegment('faculty-directory')
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
  const routeType = String(route?.routeType || 'UNKNOWN').trim().toUpperCase();
  const destination =
    normalizePublicUrlDestination(route?.url) ||
    normalizePublicUrlDestination(route?.sourceUrl) ||
    String(route?.email || '').trim().toLowerCase() ||
    String(route?.label || route?.name || '').trim().toLowerCase();
  return `${routeType}:${destination}`;
}

function contactRouteRank(route: any): number {
  let rank = 0;
  if (String(route?._id || '').startsWith('derived-pi-outreach-')) rank -= 20;
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
      const fallbackKey = String(route?._id || `route-${index}`);
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
      String(a?._id || '').localeCompare(String(b?._id || '')),
  );
}

const publicContactRouteForResearchDetail = (route: any) => ({
  ...route,
  label: publicString(route.label),
  rationale: publicString(route.rationale),
  url: publicHttpUrl(route.url),
  sourceUrl: publicHttpUrl(route.sourceUrl),
});

export function buildLeadPiOutreachContactRoute(
  members: Array<{ user: any; role: string; row?: any }>,
  group: any,
): any | null {
  const groupHasContactEmail = Boolean(String(group?.contactEmail || '').trim());

  const lead = members
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .find((member) => String(member.user?.email || '').trim() || resolveLeadOfficialProfileUrl(member));
  if (!lead) return null;

  const email = groupHasContactEmail ? '' : publicContactEmail(lead.user.email) || '';
  const name = memberDisplayName(lead);
  const officialProfileUrl = resolveLeadOfficialProfileUrl(lead);
  if (!email && !officialProfileUrl) return null;

  const key = String(lead.user?._id || lead.user?.netid || name || email)
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
    contactPolicy: email ? 'DIRECT_CONTACT_OK' : 'OFFICIAL_ROUTE_PREFERRED',
    rationale: officialProfileUrl
      ? 'Derived from the attached lead PI official profile.'
      : 'Derived from the attached lead PI profile email.',
    sourceUrl: officialProfileUrl || lead.row?.sourceUrl || group?.websiteUrl || '',
  } as any;

  if (email) route.email = email;
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
  const secondary: string[] = (Array.isArray(user?.secondaryDepartments) ? user.secondaryDepartments : [])
    .flatMap(normalizedWordsForMatch);

  if (departments.some((word: string) => primary.includes(word))) return 30;
  if (departments.some((word: string) => secondary.includes(word))) return 12;
  return 0;
}

function memberEvidenceScore(member: { user: any; role: string; row?: any }, group: any): number {
  const user = member.user || {};
  const row = member.row || {};
  const contactEmail = String(group?.contactEmail || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  const contactNetid = contactEmail.endsWith('@yale.edu') ? contactEmail.replace(/@yale\.edu$/, '') : '';
  const netid = String(user.netid || '').trim().toLowerCase();
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

  if (duplicateKeys.size === 0) return members;

  const keepByKey = new Map<string, T>();
  for (const key of duplicateKeys) {
    const bucket = buckets.get(key) || [];
    keepByKey.set(
      key,
      [...bucket].sort((a, b) => {
        const byScore = memberEvidenceScore(b, group) - memberEvidenceScore(a, group);
        if (byScore !== 0) return byScore;
        return String(a.user?._id || '').localeCompare(String(b.user?._id || ''));
      })[0],
    );
  }

  return members.filter((member) => {
    const key = `${member.role}:${normalizedMemberName(member)}`;
    return !duplicateKeys.has(key) || keepByKey.get(key) === member;
  });
}

export function buildResearchActivityLinkPayload({
  researchEntityId,
  entityLinkedPapers = [],
  memberPaperPairs = [],
  entityScholarlyLinks = [],
  memberScholarlyLinkPairs = [],
}: {
  researchEntityId: unknown;
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
  }>;
}) {
  const seen = new Set<string>();
  const uniqueKey = (basis: string, id: unknown, owner?: unknown) =>
    [basis, String(id || ''), String(owner || '')].join(':');

  const scholarlyLinks = [
    ...entityScholarlyLinks.map((link) =>
      scholarlyLinkToPublicLink(link, {
        researchEntityId,
        relationshipBasis: 'explicit_entity_link',
        evidenceLabel: 'Linked to this research profile',
      }),
    ),
    ...entityLinkedPapers.map((paper) => ({
      ...paperToScholarlyLink(paper),
      researchEntityId: String(researchEntityId || ''),
      relationshipBasis: 'explicit_entity_link',
      evidenceLabel: 'Linked to this research profile',
    })),
  ]
    .filter((link) => {
      const key = uniqueKey(link.relationshipBasis || '', link._id);
      if (seen.has(key) || !isPublicResearchPaperLink(link)) return false;
      seen.add(key);
      return true;
    });

  const memberScholarlyLinks = [
    ...memberScholarlyLinkPairs
      .filter((pair) => pair.memberDisplayId)
      .map((pair) =>
        scholarlyLinkToPublicLink(pair.link, {
          userId: pair.memberDisplayId,
          relationshipBasis: pair.relationshipBasis || 'identity_authorship',
          evidenceLabel: pair.evidenceLabel || 'Authored by a verified Yale faculty identity',
          confidence: pair.confidence,
          observedAt: pair.observedAt,
          sourceName: pair.sourceName,
          sourceUrl: pair.sourceUrl,
        }),
      ),
    ...memberPaperPairs
    .filter((pair) => pair.memberDisplayId)
    .map((pair) => ({
      ...paperToScholarlyLink(pair.paper, pair.memberDisplayId),
      relationshipBasis: 'member_authorship',
      evidenceLabel: 'Authored by a listed professor',
    })),
  ]
    .filter((link) => {
      const key = uniqueKey(link.relationshipBasis || '', link._id, link.userId);
      if (seen.has(key) || !isPublicResearchPaperLink(link)) return false;
      seen.add(key);
      return true;
    });

  return {
    scholarlyLinks,
    memberScholarlyLinks,
    researchActivityLinks: [...scholarlyLinks, ...memberScholarlyLinks],
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

const publicListingForResearchDetail = (listing: any) => ({
  _id: listing._id,
  id: String(listing._id),
  researchEntityId: listing.researchEntityId,
  researchGroupId: listing.researchGroupId,
  title: listing.title,
  description: listing.description,
  type: listing.type,
  commitment: listing.commitment,
  compensationType: listing.compensationType,
  applicantDescription: listing.applicantDescription,
  hiringStatus: listing.hiringStatus,
  websites: publicHttpUrls(listing.websites),
  departments: Array.isArray(listing.departments) ? listing.departments : [],
  researchAreas: Array.isArray(listing.researchAreas) ? listing.researchAreas : [],
  keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
  expiresAt: listing.expiresAt,
  createdAt: listing.createdAt,
  updatedAt: listing.updatedAt,
});

const publicString = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

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
  researchEntityId: pathway.researchEntityId,
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
  createdAt: pathway.createdAt,
  updatedAt: pathway.updatedAt,
});

const publicAccessSignalForResearchDetail = (signal: any) => ({
  _id: signal._id,
  researchEntityId: signal.researchEntityId,
  entryPathwayId: signal.entryPathwayId,
  signalType: signal.signalType,
  confidence: signal.confidence,
  confidenceScore: signal.confidenceScore,
  excerpt: publicString(signal.excerpt),
  sourceUrl: publicHttpUrl(signal.sourceUrl),
  observedAt: signal.observedAt,
  createdAt: signal.createdAt,
  updatedAt: signal.updatedAt,
});

const publicPostedOpportunityForResearchDetail = (opportunity: any) => ({
  _id: opportunity._id,
  entryPathwayId: opportunity.entryPathwayId,
  researchEntityId: opportunity.researchEntityId,
  listingId: opportunity.listingId,
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
  createdAt: opportunity.createdAt,
  updatedAt: opportunity.updatedAt,
});

/**
 * Detail payload for the lab page: the group itself, member User snapshots
 * (PIs first), the most recent papers across all members, and the group's
 * non-archived listings.
 */
export async function getResearchGroupDetail(slug: string): Promise<{
  researchEntity: PublicResearchEntityDto;
  members: Array<{ user: any; role: string }>;
  recentPapers: any[];
  recentArxivPreprints: any[];
  researchActivityLinks: any[];
  scholarlyLinks: any[];
  memberScholarlyLinks: any[];
  activeListings: any[];
  entryPathways: any[];
  accessSignals: any[];
  contactRoutes: any[];
  postedOpportunities: any[];
  entityRelationships: any[];
  relatedResearchEntities: PublicResearchEntityDto[];
  affiliatedRelationships: any[];
  affiliatedResearchEntities: PublicResearchEntityDto[];
} | null> {
  const group = await ResearchEntity.findOne({
    slug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();
  if (!group) return null;

  const memberRows: any[] = await ResearchGroupMember.find(
    currentResearchEntityMemberFilter((group as any)._id),
  ).lean();

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
          .select('netid userId name firstName lastName photoUrl primarySchool title bio email websiteUrl profileUrls')
          .lean()
      : Promise.resolve([]),
  ]);

  const usersById = new Map<string, any>(users.map((u) => [String(u._id), u]));
  const facultyMembersById = new Map<string, any>(
    facultyMembers.map((faculty) => [String(faculty._id), faculty]),
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
        member.user._id ||
        [member.user.fname, member.user.lname].filter(Boolean).join(' ');
      const key = `${String(userKey).toLowerCase()}:${member.role}`;
      return (
        index ===
        rows.findIndex((candidate) => {
          const candidateUserKey =
            candidate.user.netid ||
            candidate.user._id ||
            [candidate.user.fname, candidate.user.lname].filter(Boolean).join(' ');
          return `${String(candidateUserKey).toLowerCase()}:${candidate.role}` === key;
        })
      );
    })
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));
  const imageGuardedMembersWithRows = await withPublicMemberImageGuards(membersWithRows);
  const dedupedMembersWithRows = dedupeSameNameLeadMembers(imageGuardedMembersWithRows, group);
  const piOutreachRoute = buildLeadPiOutreachContactRoute(dedupedMembersWithRows, group);
  const members = dedupedMembersWithRows.map(({ row, ...member }) => {
    return {
      ...member,
      user: publicMemberUserForResearchDetail(member.user),
    };
  });

  const memberDisplayIds = Array.from(
    new Set(
      members
        .map((member) => member.user?._id)
        .filter(Boolean)
        .map((id) => String(id)),
    ),
  );
  const memberDisplayObjectIds = memberDisplayIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const attributionRows = memberDisplayObjectIds.length
    ? await ResearchScholarlyAttribution.find({
        targetUserId: { $in: memberDisplayObjectIds },
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
    new Set(attributionRows.map((row: any) => String(row.scholarlyLinkId)).filter(Boolean)),
  );

  const [
    recentPapers,
    recentArxivPreprints,
    entityScholarlyLinks,
    attributedScholarlyLinks,
    activeListingsRaw,
    entryPathways,
    accessSignals,
    contactRoutes,
    postedOpportunities,
    accessSummary,
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
    Listing.find({ researchEntityId: (group as any)._id, archived: false }).lean(),
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
  ]);
  const entityContactRoutes = (contactRoutes as any[]).filter(
    (route) => !isResearchWebsiteFacultyPiRoute(route, group),
  );
  const publicContactRoutes = dedupePublicContactRoutes(
    piOutreachRoute ? [...entityContactRoutes, piOutreachRoute] : entityContactRoutes,
  ).map(publicContactRouteForResearchDetail);

  const scholarlyLinksById = new Map(
    (attributedScholarlyLinks as any[]).map((link) => [String(link._id), link]),
  );
  const memberScholarlyLinkPairs = (attributionRows as any[])
    .flatMap((row) => {
      const link = scholarlyLinksById.get(String(row.scholarlyLinkId));
      if (!link) return [];
      return [{
        link,
        memberDisplayId: row.targetUserId,
        relationshipBasis: row.relationshipBasis,
        evidenceLabel: row.evidenceLabel,
        confidence: row.confidence,
        observedAt: row.observedAt,
        sourceName: row.sourceName,
        sourceUrl: row.sourceUrl,
      }];
    });
  const researchActivity = buildResearchActivityLinkPayload({
    researchEntityId: (group as any)._id,
    entityScholarlyLinks: entityScholarlyLinks as any[],
    memberScholarlyLinkPairs,
  });

  const activeListings = activeListingsRaw.map(publicListingForResearchDetail);
  const publicGroup = sanitizeFacultyResearchEntityCopyFields(
    sanitizeResearchEntityPublicDescriptionFields(group as any),
  );
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
      ...publicGroup,
      accessSummary,
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
