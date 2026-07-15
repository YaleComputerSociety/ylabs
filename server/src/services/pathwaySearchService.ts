import { Types, type PipelineStage } from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import type {
  CompensationType,
  EntryPathwayStatus,
  EntryPathwayType,
  EvidenceStrength,
  ResearchEntityType,
} from '../models/researchAccessTypes';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { studentPathwayMongoMatch } from './studentAccessPublicationPolicy';

export const pathwayBestNextStepCategories = [
  'apply',
  'find-funding',
  'plan-outreach',
  'contact-program',
  'save-for-later',
  'check-back-later',
] as const;

export type PathwayBestNextStepCategory = (typeof pathwayBestNextStepCategories)[number];

export interface PathwaySearchFilters {
  pathwayIds?: string[];
  entityIds?: string[];
  pathwayType?: EntryPathwayType[];
  compensation?: CompensationType[];
  status?: EntryPathwayStatus[];
  evidenceStrength?: EvidenceStrength[];
  entityType?: ResearchEntityType[];
  departments?: string[];
  researchAreas?: string[];
  hasActivePostedOpportunity?: boolean;
  bestNextStepCategory?: PathwayBestNextStepCategory[];
}

export interface PathwaySearchSort {
  sortBy?: 'relevance' | 'confidence' | 'lastObservedAt' | 'deadline';
  sortOrder?: 'asc' | 'desc';
}

export interface PathwaySearchInput {
  q?: string;
  page?: number;
  pageSize?: number;
  filters?: PathwaySearchFilters;
  sort?: PathwaySearchSort;
}

export interface PathwaySearchResearchEntityHit {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  entityType?: string;
  departments: string[];
  researchAreas: string[];
  school?: string;
  websiteUrl?: string;
}

export interface PathwaySearchPostedOpportunityHit {
  _id: string;
  title: string;
  deadline?: Date;
  applicationUrl?: string;
  status: 'OPEN' | 'ROLLING';
  term?: string;
}

export interface PathwaySearchEvidenceHit {
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  excerpt?: string;
  sourceUrl?: string;
  observedAt?: Date;
}

export interface PathwaySearchContactRouteHit {
  routeType: string;
  label?: string;
  url?: string;
  contactPolicy?: string;
  visibility?: string;
  rationale?: string;
}

export interface PathwaySearchHit {
  _id: string;
  pathwayType: string;
  status: string;
  evidenceStrength: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  bestNextStepCategory: PathwayBestNextStepCategory;
  compensation?: string;
  confidence?: number;
  sourceUrls: string[];
  lastObservedAt?: Date;
  researchEntity: PathwaySearchResearchEntityHit;
  activePostedOpportunity?: PathwaySearchPostedOpportunityHit;
  evidence: PathwaySearchEvidenceHit[];
  contactRoute?: PathwaySearchContactRouteHit;
}

export interface PathwaySearchResult {
  hits: PathwaySearchHit[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
}

interface BestNextStepSnapshot {
  pathwayType?: string;
  status?: string;
  activePostedOpportunity?: unknown;
  contactRoute?: {
    routeType?: string;
  };
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE = 1000;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_FILTER_VALUES = 50;
const MAX_FILTER_VALUE_LENGTH = 120;
const FORMALIZATION_ONLY_PATHWAY_TYPES: EntryPathwayType[] = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];
const FORMALIZATION_ONLY_PATHWAY_TYPE_SET = new Set<string>(FORMALIZATION_ONLY_PATHWAY_TYPES);

const trimValues = (values?: unknown[]): string[] =>
  (values || [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

const boundedSearchQuery = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
};

const boundedFilterValues = (values?: unknown[]): string[] =>
  Array.from(
    new Set(
      trimValues(values)
        .map((value) => value.slice(0, MAX_FILTER_VALUE_LENGTH))
        .filter(Boolean),
    ),
  ).slice(0, MAX_FILTER_VALUES);

const sanitizePathwaySearchFilters = (
  filters: PathwaySearchFilters = {},
): PathwaySearchFilters => ({
  pathwayIds: boundedFilterValues(filters.pathwayIds),
  entityIds: boundedFilterValues(filters.entityIds),
  pathwayType: boundedFilterValues(filters.pathwayType) as EntryPathwayType[],
  compensation: boundedFilterValues(filters.compensation) as CompensationType[],
  status: boundedFilterValues(filters.status) as EntryPathwayStatus[],
  evidenceStrength: boundedFilterValues(filters.evidenceStrength) as EvidenceStrength[],
  entityType: boundedFilterValues(filters.entityType) as ResearchEntityType[],
  departments: boundedFilterValues(filters.departments),
  researchAreas: boundedFilterValues(filters.researchAreas),
  ...(typeof filters.hasActivePostedOpportunity === 'boolean'
    ? { hasActivePostedOpportunity: filters.hasActivePostedOpportunity }
    : {}),
  bestNextStepCategory: boundedFilterValues(
    filters.bestNextStepCategory,
  ) as PathwayBestNextStepCategory[],
});

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PATHWAY_SEARCH_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const toObjectIds = (ids?: string[]): Types.ObjectId[] =>
  Array.from(new Set(trimValues(ids)))
    .filter((id) => PATHWAY_SEARCH_OBJECT_ID_RE.test(id))
    .map((id) => new Types.ObjectId(id));

const publicText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? redactDirectContactInfo(trimmed) : undefined;
};

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return isPublicHttpUrl(trimmed) ? trimmed : undefined;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (values: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map(publicHttpUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  );

const omitUndefined = <T extends Record<string, any>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

export function getBestNextStepCategory(
  snapshot: BestNextStepSnapshot,
): PathwayBestNextStepCategory {
  if (snapshot.status === 'NOT_CURRENTLY_AVAILABLE') {
    return 'check-back-later';
  }

  if (snapshot.activePostedOpportunity || snapshot.pathwayType === 'POSTED_ROLE') {
    return 'apply';
  }

  if (snapshot.contactRoute?.routeType === 'OFFICIAL_APPLICATION') {
    return 'apply';
  }

  if (
    snapshot.contactRoute?.routeType === 'PROGRAM_MANAGER' ||
    snapshot.contactRoute?.routeType === 'DEPARTMENT_CONTACT' ||
    snapshot.contactRoute?.routeType === 'FELLOWSHIP_OFFICE' ||
    snapshot.contactRoute?.routeType === 'COURSE_INSTRUCTOR'
  ) {
    return 'contact-program';
  }

  if (
    snapshot.pathwayType === 'EXPLORATORY_CONTACT' ||
    snapshot.pathwayType === 'VOLUNTEER_OUTREACH' ||
    snapshot.pathwayType === 'FACULTY_SUPERVISION'
  ) {
    return 'plan-outreach';
  }

  if (snapshot.status === 'NO_EVIDENCE' || snapshot.status === 'HISTORICAL') {
    return 'save-for-later';
  }

  return 'save-for-later';
}

function buildBestNextStepCategoryExpression(): Record<string, unknown> {
  return {
    $switch: {
      branches: [
        {
          case: { $eq: ['$status', 'NOT_CURRENTLY_AVAILABLE'] },
          then: 'check-back-later',
        },
        {
          case: {
            $or: [
              { $ne: [{ $ifNull: ['$activePostedOpportunity', null] }, null] },
              { $eq: ['$pathwayType', 'POSTED_ROLE'] },
              { $eq: ['$contactRoute.routeType', 'OFFICIAL_APPLICATION'] },
            ],
          },
          then: 'apply',
        },
        {
          case: {
            $in: [
              '$contactRoute.routeType',
              ['PROGRAM_MANAGER', 'DEPARTMENT_CONTACT', 'FELLOWSHIP_OFFICE', 'COURSE_INSTRUCTOR'],
            ],
          },
          then: 'contact-program',
        },
        {
          case: {
            $in: [
              '$pathwayType',
              ['EXPLORATORY_CONTACT', 'VOLUNTEER_OUTREACH', 'FACULTY_SUPERVISION'],
            ],
          },
          then: 'plan-outreach',
        },
        {
          case: { $in: ['$status', ['NO_EVIDENCE', 'HISTORICAL']] },
          then: 'save-for-later',
        },
      ],
      default: 'save-for-later',
    },
  };
}

function compactMatch(match: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(match).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }),
  );
}

function buildPathwayMatch(filters: PathwaySearchFilters): Record<string, unknown> {
  const pathwayIds = toObjectIds(filters.pathwayIds);
  const hasPathwayIdFilter = trimValues(filters.pathwayIds).length > 0;
  const requestedPathwayTypes = (filters.pathwayType || []).filter(
    (pathwayType) => !FORMALIZATION_ONLY_PATHWAY_TYPE_SET.has(pathwayType),
  );
  const pathwayType =
    filters.pathwayType && filters.pathwayType.length > 0
      ? { $in: requestedPathwayTypes }
      : { $nin: FORMALIZATION_ONLY_PATHWAY_TYPES };

  return compactMatch({
    archived: { $ne: true },
    ...studentPathwayMongoMatch(),
    _id: hasPathwayIdFilter ? { $in: pathwayIds } : undefined,
    pathwayType,
    compensation:
      filters.compensation && filters.compensation.length > 0
        ? { $in: filters.compensation }
        : undefined,
    status: filters.status && filters.status.length > 0 ? { $in: filters.status } : undefined,
    evidenceStrength:
      filters.evidenceStrength && filters.evidenceStrength.length > 0
        ? { $in: filters.evidenceStrength }
        : undefined,
  });
}

function buildEntityMatch(filters: PathwaySearchFilters): Record<string, unknown> {
  const departments = trimValues(filters.departments);
  const researchAreas = trimValues(filters.researchAreas);
  const entityIds = toObjectIds(filters.entityIds);

  return compactMatch({
    'researchEntity.archived': { $ne: true },
    'researchEntity.studentVisibilityTier': { $in: publicStudentVisibilityTiers },
    'researchEntity._id': trimValues(filters.entityIds).length > 0 ? { $in: entityIds } : undefined,
    'researchEntity.entityType':
      filters.entityType && filters.entityType.length > 0 ? { $in: filters.entityType } : undefined,
    'researchEntity.departments': departments.length > 0 ? { $in: departments } : undefined,
    'researchEntity.researchAreas': researchAreas.length > 0 ? { $in: researchAreas } : undefined,
  });
}

function buildTextMatch(query: string): PipelineStage.Match | null {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return null;

  const regex = new RegExp(escapeRegExp(trimmedQuery), 'i');
  return {
    $match: {
      $or: [
        { studentFacingLabel: regex },
        { explanation: regex },
        { bestNextStep: regex },
        { pathwayType: regex },
        { compensation: regex },
        { 'researchEntity.name': regex },
        { 'researchEntity.displayName': regex },
        { 'researchEntity.departments': regex },
        { 'researchEntity.researchAreas': regex },
        { 'researchEntity.school': regex },
      ],
    },
  };
}

function buildSort(sort: PathwaySearchSort, query: string): Record<string, 1 | -1> {
  const direction = sort.sortOrder === 'asc' ? 1 : -1;

  switch (sort.sortBy) {
    case 'confidence':
      return { confidence: direction, lastObservedAt: -1, studentFacingLabel: 1 };
    case 'lastObservedAt':
      return { lastObservedAt: direction, confidence: -1, studentFacingLabel: 1 };
    case 'deadline':
      return {
        'activePostedOpportunity.deadline': direction,
        confidence: -1,
        studentFacingLabel: 1,
      };
    case 'relevance':
    default:
      if (query.trim()) {
        return { confidence: -1, lastObservedAt: -1, studentFacingLabel: 1 };
      }
      return { lastObservedAt: -1, confidence: -1, studentFacingLabel: 1 };
  }
}

const publicResearchEntityKey = (entity: Record<string, any> | undefined): string =>
  publicText(entity?.slug) || publicText(entity?.displayName) || publicText(entity?.name) || '';

const pathwaySearchDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

function normalizeHit(raw: Record<string, any>): PathwaySearchHit {
  const contactRoute =
    raw.contactRoute?.visibility === 'PUBLIC'
      ? omitUndefined({
          routeType: raw.contactRoute.routeType,
          label: publicText(raw.contactRoute.label),
          url: publicHttpUrl(raw.contactRoute.url),
          contactPolicy: raw.contactRoute.contactPolicy,
          visibility: raw.contactRoute.visibility,
          rationale: publicText(raw.contactRoute.rationale),
        })
      : undefined;

  return {
    _id: pathwaySearchDocumentId(raw._id),
    pathwayType: raw.pathwayType,
    status: raw.status,
    evidenceStrength: raw.evidenceStrength,
    studentFacingLabel: publicText(raw.studentFacingLabel) || '',
    explanation: publicText(raw.explanation),
    bestNextStep: publicText(raw.bestNextStep),
    bestNextStepCategory: raw.bestNextStepCategory,
    compensation: raw.compensation,
    confidence: raw.confidence,
    sourceUrls: publicHttpUrls(raw.sourceUrls),
    lastObservedAt: raw.lastObservedAt,
    researchEntity: {
      _id: publicResearchEntityKey(raw.researchEntity),
      slug: raw.researchEntity?.slug || '',
      name: publicText(raw.researchEntity?.name) || '',
      displayName: publicText(raw.researchEntity?.displayName),
      kind: raw.researchEntity?.kind,
      entityType: raw.researchEntity?.entityType,
      departments: raw.researchEntity?.departments || [],
      researchAreas: raw.researchEntity?.researchAreas || [],
      school: publicText(raw.researchEntity?.school),
      websiteUrl: publicHttpUrl(raw.researchEntity?.websiteUrl || raw.researchEntity?.website),
    },
    activePostedOpportunity: raw.activePostedOpportunity
      ? omitUndefined({
          _id: pathwaySearchDocumentId(raw.activePostedOpportunity._id),
          title: publicText(raw.activePostedOpportunity.title) || '',
          deadline: raw.activePostedOpportunity.deadline,
          applicationUrl: publicHttpUrl(raw.activePostedOpportunity.applicationUrl),
          status: raw.activePostedOpportunity.status,
          term: publicText(raw.activePostedOpportunity.term),
        })
      : undefined,
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map((item: any) =>
          omitUndefined({
            signalType: item.signalType,
            confidence: item.confidence,
            confidenceScore: item.confidenceScore,
            excerpt: publicText(item.excerpt),
            sourceUrl: publicHttpUrl(item.sourceUrl),
            observedAt: item.observedAt,
          }),
        )
      : [],
    contactRoute,
  };
}

export async function searchPathways(input: PathwaySearchInput): Promise<PathwaySearchResult> {
  const filters = sanitizePathwaySearchFilters(input.filters || {});
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(input.page || 1)));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(input.pageSize || DEFAULT_PAGE_SIZE)),
  );
  const skip = (page - 1) * pageSize;
  const query = boundedSearchQuery(input.q);
  const sort = input.sort || {};

  const pipeline: PipelineStage[] = [
    { $match: buildPathwayMatch(filters) },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'researchEntity',
      },
    },
    { $unwind: '$researchEntity' },
    { $match: buildEntityMatch(filters) },
    {
      $lookup: {
        from: 'posted_opportunities',
        let: { pathwayId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$entryPathwayId', '$$pathwayId'] },
                  { $ne: ['$archived', true] },
                  { $in: ['$status', ['OPEN', 'ROLLING']] },
                ],
              },
            },
          },
          { $sort: { deadline: 1, createdAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 1,
              title: 1,
              deadline: 1,
              applicationUrl: 1,
              status: 1,
              term: 1,
            },
          },
        ],
        as: 'activePostedOpportunities',
      },
    },
    {
      $addFields: {
        activePostedOpportunity: { $arrayElemAt: ['$activePostedOpportunities', 0] },
      },
    },
  ];

  if (typeof filters.hasActivePostedOpportunity === 'boolean') {
    pipeline.push({
      $match: filters.hasActivePostedOpportunity
        ? { activePostedOpportunity: { $ne: null } }
        : { activePostedOpportunity: null },
    });
  }

  const textMatch = buildTextMatch(query);
  if (textMatch) pipeline.push(textMatch);

  pipeline.push(
    {
      $lookup: {
        from: 'access_signals',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      {
                        $and: [
                          { $eq: ['$researchEntityId', '$$entityId'] },
                          { $eq: [{ $ifNull: ['$entryPathwayId', null] }, null] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { confidenceScore: -1, observedAt: -1 } },
          { $limit: 3 },
          {
            $project: {
              _id: 0,
              signalType: 1,
              confidence: 1,
              confidenceScore: 1,
              excerpt: 1,
              sourceUrl: 1,
              observedAt: 1,
            },
          },
        ],
        as: 'evidence',
      },
    },
    {
      $lookup: {
        from: 'contact_routes',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  { $eq: ['$visibility', 'PUBLIC'] },
                  { $ne: ['$contactPolicy', 'NO_DIRECT_CONTACT'] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      {
                        $and: [
                          { $eq: ['$researchEntityId', '$$entityId'] },
                          { $eq: [{ $ifNull: ['$entryPathwayId', null] }, null] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            $addFields: {
              contactPolicyRank: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$contactPolicy', 'APPLICATION_ONLY'] }, then: 0 },
                    { case: { $eq: ['$contactPolicy', 'OFFICIAL_ROUTE_PREFERRED'] }, then: 1 },
                    { case: { $eq: ['$contactPolicy', 'DIRECT_CONTACT_OK'] }, then: 2 },
                  ],
                  default: 5,
                },
              },
              routeTypeRank: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$routeType', 'OFFICIAL_APPLICATION'] }, then: 0 },
                    { case: { $eq: ['$routeType', 'PROGRAM_MANAGER'] }, then: 1 },
                    { case: { $eq: ['$routeType', 'DEPARTMENT_CONTACT'] }, then: 2 },
                    { case: { $eq: ['$routeType', 'FELLOWSHIP_OFFICE'] }, then: 3 },
                    { case: { $eq: ['$routeType', 'COURSE_INSTRUCTOR'] }, then: 4 },
                    { case: { $eq: ['$routeType', 'LAB_MANAGER'] }, then: 5 },
                    { case: { $eq: ['$routeType', 'FACULTY_PI'] }, then: 8 },
                  ],
                  default: 9,
                },
              },
            },
          },
          { $sort: { contactPolicyRank: 1, routeTypeRank: 1, priority: 1, updatedAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 0,
              routeType: 1,
              label: 1,
              url: 1,
              contactPolicy: 1,
              visibility: 1,
              rationale: 1,
            },
          },
        ],
        as: 'contactRoutes',
      },
    },
    {
      $addFields: {
        contactRoute: { $arrayElemAt: ['$contactRoutes', 0] },
      },
    },
    {
      $addFields: {
        bestNextStepCategory: buildBestNextStepCategoryExpression(),
      },
    },
  );

  if (filters.bestNextStepCategory && filters.bestNextStepCategory.length > 0) {
    pipeline.push({
      $match: {
        bestNextStepCategory: { $in: filters.bestNextStepCategory },
      },
    });
  }

  pipeline.push({
    $facet: {
      hits: [
        { $sort: buildSort(sort, query) },
        { $skip: skip },
        { $limit: pageSize },
        {
          $project: {
            _id: 1,
            pathwayType: 1,
            status: 1,
            evidenceStrength: 1,
            studentFacingLabel: 1,
            explanation: 1,
            bestNextStep: 1,
            bestNextStepCategory: 1,
            compensation: 1,
            confidence: 1,
            sourceUrls: 1,
            lastObservedAt: 1,
            createdAt: 1,
            researchEntity: {
              _id: '$researchEntity._id',
              slug: '$researchEntity.slug',
              name: '$researchEntity.name',
              displayName: '$researchEntity.displayName',
              kind: '$researchEntity.kind',
              entityType: '$researchEntity.entityType',
              departments: '$researchEntity.departments',
              researchAreas: '$researchEntity.researchAreas',
              school: '$researchEntity.school',
              websiteUrl: '$researchEntity.websiteUrl',
              website: '$researchEntity.website',
            },
            activePostedOpportunity: 1,
            evidence: 1,
            contactRoute: 1,
          },
        },
      ],
      total: [{ $count: 'count' }],
    },
  });

  const [result] = await EntryPathway.aggregate(pipeline).exec();
  const rawHits = Array.isArray(result?.hits) ? result.hits : [];
  const totalCount =
    Array.isArray(result?.total) && result.total[0]?.count ? Number(result.total[0].count) : 0;

  return {
    hits: rawHits.map(normalizeHit),
    estimatedTotalHits: totalCount,
    page,
    pageSize,
  };
}

export async function getPathwaysByIds(ids: string[]): Promise<PathwaySearchHit[]> {
  const validIds = toObjectIds(ids).map((id) => id.toString());
  if (validIds.length === 0) return [];

  const result = await searchPathways({
    page: 1,
    pageSize: Math.min(MAX_PAGE_SIZE, validIds.length),
    filters: { pathwayIds: validIds },
    sort: { sortBy: 'lastObservedAt', sortOrder: 'desc' },
  });

  const hitsById = new Map(result.hits.map((hit) => [hit._id, hit]));
  return validIds.map((id) => hitsById.get(id)).filter(Boolean) as PathwaySearchHit[];
}
