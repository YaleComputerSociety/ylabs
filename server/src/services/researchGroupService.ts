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
import { ResearchGroupMember } from '../models/researchGroupMember';
import { Department, DepartmentCategory } from '../models/department';
import { Paper } from '../models/paper';
import { PaperGroupLink } from '../models/paperGroupLink';
import { Listing } from '../models/listing';
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
import {
  buildResearchGroupFilterString,
  ResearchGroupFilterInput,
} from './researchGroupFilters';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  addResearchEntityDetailAlias,
  addResearchEntitySearchAliases,
  type PublicResearchEntityDto,
} from './researchEntityDto';

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

export interface ResearchGroupSearchResult {
  researchEntities: PublicResearchEntityDto[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 100;

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
): Promise<ResearchGroupSearchResult> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 24));
  const offset = (safePage - 1) * safePageSize;

  const filterString = buildResearchGroupFilterString(filters || {});

  const trimmedQuery = (query || '').trim();
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
  const activeListingGroupIds =
    hitIds.length > 0
      ? await Listing.distinct('researchEntityId', {
          researchEntityId: { $in: hitIds },
          archived: false,
        })
      : [];
  const activeListingGroupIdSet = new Set(activeListingGroupIds.map((id: any) => String(id)));

  // Map Meilisearch's `id` back to `_id` for client backward compatibility.
  const accessSummaries = await listAccessSummariesForResearchEntities(hitIds);
  const normalizedHits = (hits || []).map((hit: any) => {
    const id = hit.id || hit._id;
    return {
      ...hit,
      _id: id,
      hasActiveListing: activeListingGroupIdSet.has(String(id)),
      accessSummary: accessSummaries.get(String(id)),
    };
  });

  return addResearchEntitySearchAliases({
    hits: normalizedHits,
    estimatedTotalHits: estimatedTotalHits ?? normalizedHits.length,
    page: safePage,
    pageSize: safePageSize,
  });
}

const PUBLIC_USER_FIELDS = 'netid fname lname imageUrl primaryDepartment title secondaryDepartments';

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
  activeListings: any[];
  entryPathways: any[];
  accessSignals: any[];
  contactRoutes: any[];
  postedOpportunities: any[];
} | null> {
  const group = await ResearchEntity.findOne({ slug }).lean();
  if (!group) return null;

  const memberRows: any[] = await ResearchGroupMember.find({
    researchEntityId: (group as any)._id,
  }).lean();

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
    .map((row) => ({
      user: usersById.get(String(row.userId)) || null,
      role: row.role,
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
    .sort((a, b) => (ROLE_PRIORITY[a.role] ?? 99) - (ROLE_PRIORITY[b.role] ?? 99));

  const linkedPaperRows = await PaperGroupLink.find({
    researchEntityId: (group as any)._id,
    archived: false,
  })
    .select('paperId')
    .lean();
  const linkedPaperIds = linkedPaperRows.map((row: any) => row.paperId).filter(Boolean);

  const [
    recentPapers,
    recentArxivPreprints,
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
    linkedPaperIds.length || memberUserIds.length
      ? Paper.find({
          archived: false,
          ...(linkedPaperIds.length && memberUserIds.length
            ? {
                $and: [
                  {
                    $or: [
                      { _id: { $in: linkedPaperIds } },
                      { yaleAuthorIds: { $in: memberUserIds } },
                    ],
                  },
                ],
              }
            : linkedPaperIds.length
              ? { _id: { $in: linkedPaperIds } }
              : { yaleAuthorIds: { $in: memberUserIds } }),
          $or: [{ preprintServer: 'arxiv' }, { publicationStage: 'PREPRINT' }],
        })
          .sort({ postedAt: -1, versionDate: -1, publishedAt: -1 })
          .limit(10)
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

  const activeListings = activeListingsRaw.map((listing: any) => ({
    ...listing,
    id: String(listing._id),
  }));

  return addResearchEntityDetailAlias({
    group: {
      ...group,
      accessSummary,
    },
    members,
    recentPapers,
    recentArxivPreprints,
    activeListings,
    entryPathways,
    accessSignals,
    contactRoutes,
    postedOpportunities,
  });
}
