import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { EntryPathway } from '../models/entryPathway';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { PostedOpportunity } from '../models/postedOpportunity';
import { Observation } from '../models/observation';
import { recordReviewStatuses } from '../models/modelPrimitives';
import { buildSafeSearchRegex } from '../utils/regex';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';

export interface AccessReviewListInput {
  search?: string;
  page?: unknown;
  pageSize?: unknown;
  hasUnreviewed?: unknown;
  sort?: unknown;
}

export interface AccessReviewCountSummary {
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  postedOpportunities: number;
}

export interface AccessReviewEntitySummary {
  _id: string;
  name: string;
  slug: string;
  entityType?: string;
  kind?: string;
  departments: string[];
  researchAreas: string[];
  manuallyLockedFields: string[];
  counts: AccessReviewCountSummary;
  unreviewedCounts: AccessReviewCountSummary;
  totalUnreviewed: number;
  hasOfficialApplication: boolean;
}

export interface AccessReviewProgressSummary {
  reviewedToday: number;
  remaining: number;
}

export type AccessReviewRecordType =
  | 'entryPathway'
  | 'accessSignal'
  | 'contactRoute'
  | 'postedOpportunity';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1000;
const MAX_ACCESS_REVIEW_SEARCH_QUERY_LENGTH = 120;
const MAX_ACCESS_REVIEW_LOCKED_FIELDS = 100;
const MAX_ACCESS_REVIEW_EVIDENCE_IDS = 100;
export const MAX_ACCESS_REVIEW_LOCK_FIELD_LENGTH = 120;
const ACCESS_REVIEW_LOCK_FIELD_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const ACCESS_REVIEW_SORTS = new Set(['unreviewed', 'official_application', 'updated']);

export class AccessReviewRequestError extends Error {}

const accessReviewDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

export function normalizeAccessReviewObjectId(id: unknown): mongoose.Types.ObjectId | null {
  const value =
    typeof id === 'string'
      ? id.trim()
      : id instanceof mongoose.Types.ObjectId
        ? id.toHexString()
        : '';
  if (!/^[a-f0-9]{24}$/i.test(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function normalizePage(input?: unknown): number {
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(input) || 1)));
}

function normalizePageSize(input?: unknown): number {
  return Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(input) || DEFAULT_PAGE_SIZE)),
  );
}

const toObjectId = (value: unknown): mongoose.Types.ObjectId | null => {
  const id = serializedDocumentId(value);
  return id ? new mongoose.Types.ObjectId(id) : null;
};

export function normalizeAccessReviewSearchTerm(input?: string): string {
  const searchTerm = input?.trim() || '';
  if (searchTerm.length > MAX_ACCESS_REVIEW_SEARCH_QUERY_LENGTH) {
    throw new AccessReviewRequestError('Search query is too long');
  }
  return searchTerm;
}

export function normalizeAccessReviewLockedFields(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    if (normalized.length >= MAX_ACCESS_REVIEW_LOCKED_FIELDS) break;
    if (typeof value !== 'string') continue;

    const field = value.trim();
    if (
      field.length === 0 ||
      field.length > MAX_ACCESS_REVIEW_LOCK_FIELD_LENGTH ||
      !ACCESS_REVIEW_LOCK_FIELD_PATTERN.test(field) ||
      seen.has(field)
    ) {
      continue;
    }

    seen.add(field);
    normalized.push(field);
  }

  return normalized;
}

function hasEvidence(record: any): boolean {
  return (
    (Array.isArray(record.sourceEvidenceIds) && record.sourceEvidenceIds.length > 0) ||
    !!record.sourceEvidenceId ||
    !!record.observationId ||
    (Array.isArray(record.sourceUrls) && record.sourceUrls.length > 0) ||
    !!record.sourceUrl
  );
}

function sourceNames(records: any[]): string[] {
  return Array.from(
    new Set(
      records
        .map((record) => record.sourceName)
        .filter((sourceName): sourceName is string => typeof sourceName === 'string' && sourceName.length > 0),
    ),
  ).sort();
}

function evidenceIdsForRecord(record: any): mongoose.Types.ObjectId[] {
  const rawIds = [
    ...(Array.isArray(record.sourceEvidenceIds) ? record.sourceEvidenceIds : []),
    ...(Array.isArray(record.sourceEvidenceId) ? record.sourceEvidenceId : [record.sourceEvidenceId]),
    ...(Array.isArray(record.observationId) ? record.observationId : [record.observationId]),
  ];
  const ids: mongoose.Types.ObjectId[] = [];
  const seen = new Set<string>();

  for (const rawId of rawIds.slice(0, MAX_ACCESS_REVIEW_EVIDENCE_IDS)) {
    const objectId = normalizeAccessReviewObjectId(rawId);
    if (!objectId) continue;
    const key = objectId.toHexString();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(objectId);
  }

  return ids;
}

function evidenceExcerpt(value: unknown): string {
  if (typeof value === 'string') return redactDirectContactInfo(value).slice(0, 600);
  if (value === undefined || value === null) return '';
  try {
    return redactDirectContactInfo(JSON.stringify(value)).slice(0, 600);
  } catch {
    return '';
  }
}

async function loadEvidenceItems(records: any[]): Promise<Map<string, any[]>> {
  const recordIds = records.map((record) => accessReviewDocumentId(record._id));
  const idsByRecordId = new Map<string, mongoose.Types.ObjectId[]>();
  const allIds: mongoose.Types.ObjectId[] = [];

  records.forEach((record, index) => {
    const ids = evidenceIdsForRecord(record);
    idsByRecordId.set(recordIds[index], ids);
    allIds.push(...ids);
  });

  if (allIds.length === 0) return new Map(recordIds.map((id) => [id, []]));

  const observations = await Observation.find({ _id: { $in: allIds } })
    .select('sourceName sourceUrl scrapeRunId confidence observedAt field value')
    .lean();
  const byId = new Map(observations.map((obs: any) => [accessReviewDocumentId(obs._id), obs]));

  return new Map(
    recordIds.map((recordId) => [
      recordId,
      (idsByRecordId.get(recordId) || [])
        .map((id) => byId.get(accessReviewDocumentId(id)))
        .filter(Boolean)
        .map((obs: any) => ({
          observationId: accessReviewDocumentId(obs._id),
          sourceName: obs.sourceName,
          sourceUrl: obs.sourceUrl,
          scrapeRunId: accessReviewDocumentId(obs.scrapeRunId) || undefined,
          confidence: obs.confidence,
          observedAt: obs.observedAt,
          field: obs.field,
          excerpt: evidenceExcerpt(obs.value),
        })),
    ]),
  );
}

async function attachEvidenceItems(records: any[]): Promise<any[]> {
  const evidenceByRecordId = await loadEvidenceItems(records);
  return records.map((record) => ({
    ...record,
    evidenceItems: evidenceByRecordId.get(accessReviewDocumentId(record._id)) || [],
  }));
}

export function redactAccessReviewContactRoute(record: any): any {
  const { email: _email, url: _url, destination: _destination, ...safeRecord } = record;
  return safeRecord;
}

function buildReviewSummary(input: {
  group: any;
  entryPathways: any[];
  accessSignals: any[];
  contactRoutes: any[];
  postedOpportunities: any[];
}) {
  const allRecords = [
    ...input.entryPathways,
    ...input.accessSignals,
    ...input.contactRoutes,
    ...input.postedOpportunities,
  ];
  return {
    totalDerivedRecords: allRecords.length,
    archivedRecords: allRecords.filter((record) => record.archived === true).length,
    recordsMissingEvidence: allRecords.filter((record) => !hasEvidence(record)).length,
    guardedContactRoutes: input.contactRoutes.filter(
      (route) => route.visibility !== 'PUBLIC' || route.contactPolicy === 'NO_DIRECT_CONTACT',
    ).length,
    publicContactRoutes: input.contactRoutes.filter((route) => route.visibility === 'PUBLIC').length,
    manualLocks: input.group.manuallyLockedFields || [],
    sourceNames: sourceNames(allRecords),
  };
}

export async function listAccessReviewEntities(input: AccessReviewListInput = {}): Promise<{
  entities: AccessReviewEntitySummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  progress: AccessReviewProgressSummary;
}> {
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const filter: Record<string, unknown> = {};
  const hasUnreviewed = input.hasUnreviewed === true || input.hasUnreviewed === 'true';
  const sort = typeof input.sort === 'string' && ACCESS_REVIEW_SORTS.has(input.sort)
    ? input.sort
    : 'unreviewed';

  const searchTerm = normalizeAccessReviewSearchTerm(input.search);

  if (searchTerm) {
    const searchRegex = buildSafeSearchRegex(searchTerm);
    filter.$or = [
      { name: searchRegex },
      { displayName: searchRegex },
      { slug: searchRegex },
      { departments: searchRegex },
      { researchAreas: searchRegex },
    ];
  }

  const lookup = (from: string, as: string, includeApplication = false) => ({
    $lookup: {
      from,
      let: { entityId: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$researchEntityId', '$$entityId'] } } },
        { $project: { _id: 0, status: '$review.status', ...(includeApplication ? { applicationUrl: 1 } : {}) } },
      ],
      as,
    },
  });
  const pipeline: any[] = [
    { $match: filter },
    lookup('entry_pathways', '_pathways'),
    lookup('access_signals', '_signals'),
    lookup('contact_routes', '_routes'),
    lookup('posted_opportunities', '_opportunities', true),
    { $set: {
      totalUnreviewed: { $add: [
        { $size: { $filter: { input: '$_pathways', as: 'r', cond: { $in: [{ $ifNull: ['$$r.status', 'unreviewed'] }, ['unreviewed', null]] } } } },
        { $size: { $filter: { input: '$_signals', as: 'r', cond: { $in: [{ $ifNull: ['$$r.status', 'unreviewed'] }, ['unreviewed', null]] } } } },
        { $size: { $filter: { input: '$_routes', as: 'r', cond: { $in: [{ $ifNull: ['$$r.status', 'unreviewed'] }, ['unreviewed', null]] } } } },
        { $size: { $filter: { input: '$_opportunities', as: 'r', cond: { $in: [{ $ifNull: ['$$r.status', 'unreviewed'] }, ['unreviewed', null]] } } } },
      ] },
      hasOfficialApplication: { $anyElementTrue: { $map: { input: '$_opportunities', as: 'r', in: { $gt: [{ $strLenCP: { $ifNull: ['$$r.applicationUrl', ''] } }, 0] } } } },
    } },
    ...(hasUnreviewed ? [{ $match: { totalUnreviewed: { $gt: 0 } } }] : []),
    { $sort: sort === 'updated' ? { updatedAt: -1, _id: 1 } : sort === 'official_application' ? { hasOfficialApplication: -1, totalUnreviewed: -1, updatedAt: -1, _id: 1 } : { totalUnreviewed: -1, hasOfficialApplication: -1, updatedAt: -1, _id: 1 } },
    { $facet: {
      rows: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
      meta: [{ $count: 'total' }],
    } },
  ];

  const [aggregateResult, progressCounts] = await Promise.all([
    ResearchEntity.aggregate(pipeline).exec(),
    Promise.all([EntryPathway, AccessSignal, ContactRoute, PostedOpportunity].map(async (model) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [remaining, reviewedToday] = await Promise.all([
        model.countDocuments({ $or: [{ 'review.status': 'unreviewed' }, { 'review.status': { $exists: false } }] }),
        model.countDocuments({ 'review.status': { $ne: 'unreviewed' }, 'review.reviewedAt': { $gte: start } }),
      ]);
      return { remaining, reviewedToday };
    })),
  ]);
  const groups = aggregateResult[0]?.rows || [];
  const total = Number(aggregateResult[0]?.meta?.[0]?.total || 0);

  const entities = groups.map((group: any) => {
    const id = accessReviewDocumentId(group._id);
    const records = [group._pathways || [], group._signals || [], group._routes || [], group._opportunities || []];
    const counts = {
      entryPathways: records[0].length,
      accessSignals: records[1].length,
      contactRoutes: records[2].length,
      postedOpportunities: records[3].length,
    };
    const unreviewedCounts = {
      entryPathways: records[0].filter((r: any) => !r.status || r.status === 'unreviewed').length,
      accessSignals: records[1].filter((r: any) => !r.status || r.status === 'unreviewed').length,
      contactRoutes: records[2].filter((r: any) => !r.status || r.status === 'unreviewed').length,
      postedOpportunities: records[3].filter((r: any) => !r.status || r.status === 'unreviewed').length,
    };

    return {
      _id: id,
      name: group.displayName || group.name || '',
      slug: group.slug || '',
      entityType: group.entityType,
      kind: group.kind,
      departments: group.departments || [],
      researchAreas: group.researchAreas || [],
      manuallyLockedFields: group.manuallyLockedFields || [],
      counts,
      unreviewedCounts,
      totalUnreviewed: Number(group.totalUnreviewed) || 0,
      hasOfficialApplication: group.hasOfficialApplication === true,
    };
  });

  return {
    entities,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    progress: progressCounts.reduce((summary, row) => ({
      remaining: summary.remaining + row.remaining,
      reviewedToday: summary.reviewedToday + row.reviewedToday,
    }), { remaining: 0, reviewedToday: 0 }),
  };
}

export async function getAccessReviewEntity(researchEntityId: string): Promise<any | null> {
  const id = toObjectId(researchEntityId);
  if (!id) return null;

  const [group, entryPathways, accessSignals, contactRoutes, postedOpportunities] =
    await Promise.all([
      ResearchEntity.findById(id)
        .select('-embedding')
        .lean(),
      EntryPathway.find({ researchEntityId: id }).sort({ archived: 1, updatedAt: -1 }).lean(),
      AccessSignal.find({ researchEntityId: id }).sort({ archived: 1, observedAt: -1 }).lean(),
      ContactRoute.find({ researchEntityId: id }).sort({ archived: 1, priority: 1 }).lean(),
      PostedOpportunity.find({ researchEntityId: id }).sort({ archived: 1, deadline: 1 }).lean(),
    ]);

  if (!group) return null;

  return {
    group,
    entryPathways: await attachEvidenceItems(entryPathways),
    accessSignals: await attachEvidenceItems(accessSignals),
    contactRoutes: (await attachEvidenceItems(contactRoutes)).map(redactAccessReviewContactRoute),
    postedOpportunities: await attachEvidenceItems(postedOpportunities),
    reviewSummary: buildReviewSummary({
      group,
      entryPathways,
      accessSignals,
      contactRoutes,
      postedOpportunities,
    }),
  };
}

export async function updateAccessReviewManualLocks(
  researchEntityId: string,
  fields: unknown,
): Promise<any | null> {
  const id = toObjectId(researchEntityId);
  const manuallyLockedFields = normalizeAccessReviewLockedFields(fields);
  if (!id || !manuallyLockedFields) return null;

  return ResearchEntity.findByIdAndUpdate(
    id,
    { $set: { manuallyLockedFields } },
    { new: true, runValidators: true },
  )
    .select('name slug manuallyLockedFields')
    .lean();
}

function reviewModelForRecordType(type: AccessReviewRecordType): mongoose.Model<any> | null {
  switch (type) {
    case 'entryPathway':
      return EntryPathway;
    case 'accessSignal':
      return AccessSignal;
    case 'contactRoute':
      return ContactRoute;
    case 'postedOpportunity':
      return PostedOpportunity;
    default:
      return null;
  }
}

export async function updateAccessReviewRecordReview(input: {
  type: AccessReviewRecordType;
  id: string;
  status?: unknown;
  note?: unknown;
  lockedFields?: unknown;
  reviewerId?: unknown;
}): Promise<any | null> {
  const model = reviewModelForRecordType(input.type);
  const id = normalizeAccessReviewObjectId(input.id);
  if (!model || !id) return null;

  const update: Record<string, unknown> = {};

  if (
    typeof input.status === 'string' &&
    (recordReviewStatuses as readonly string[]).includes(input.status)
  ) {
    update['review.status'] = input.status;
    update['review.reviewedAt'] = new Date();
  }

  if (typeof input.note === 'string') {
    update['review.note'] = input.note.trim().slice(0, 2000);
  }

  if (Array.isArray(input.lockedFields)) {
    update['review.lockedFields'] = normalizeAccessReviewLockedFields(input.lockedFields) || [];
  }

  const reviewerId = normalizeAccessReviewObjectId(input.reviewerId);
  if (reviewerId) {
    update['review.reviewedByUserId'] = reviewerId;
  }

  if (Object.keys(update).length === 0) return null;

  if (update['review.status'] === 'archived_by_review') {
    update.archived = true;
  }

  return model
    .findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
    .lean();
}
