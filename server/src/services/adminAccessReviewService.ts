import mongoose from 'mongoose';
import { Account } from '../models/account';
import { ResearchEntity } from '../models/researchEntity';
import { AdminAccessReviewProjection } from '../models/adminAccessReviewProjection';
import { Signal } from '../models/signal';
import { Observation } from '../models/observation';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { recordReviewStatuses } from '../models/modelPrimitives';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  AdminAccessReviewProjectionUnavailableError,
  assertAdminAccessReviewProjectionReady,
  mutateAndRefreshAdminAccessReviewProjection,
} from './adminAccessReviewProjectionService';

export { AdminAccessReviewProjectionUnavailableError };

export interface AccessReviewListInput {
  search?: string;
  page?: unknown;
  pageSize?: unknown;
  hasUnreviewed?: unknown;
  sort?: unknown;
}

export interface AccessReviewCountSummary {
  accessSignals: number;
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

export type AccessReviewRecordType = 'accessSignal';

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

async function resolveReviewerAccountId(
  netid: unknown,
): Promise<mongoose.Types.ObjectId | null> {
  if (typeof netid !== 'string') return null;
  const normalized = netid.trim().toLowerCase();
  if (!normalized) return null;
  const account = await Account.findOne({ netid: normalized }).select('_id').lean();
  return (account as { _id?: mongoose.Types.ObjectId } | null)?._id ?? null;
}

function normalizePage(input?: unknown): number {
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(input) || 1)));
}

function normalizePageSize(input?: unknown): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(input) || DEFAULT_PAGE_SIZE)));
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
    (Array.isArray(record.source?.evidenceIds) && record.source.evidenceIds.length > 0) ||
    (Array.isArray(record.sourceUrls) && record.sourceUrls.length > 0) ||
    !!record.sourceUrl ||
    !!record.source?.url
  );
}

function sourceNames(records: any[]): string[] {
  return Array.from(
    new Set(
      records
        .map((record) => record.sourceName ?? record.source?.name)
        .filter(
          (sourceName): sourceName is string =>
            typeof sourceName === 'string' && sourceName.length > 0,
        ),
    ),
  ).sort();
}

function evidenceIdsForRecord(record: any): mongoose.Types.ObjectId[] {
  const rawIds = [
    ...(Array.isArray(record.sourceEvidenceIds) ? record.sourceEvidenceIds : []),
    ...(Array.isArray(record.source?.evidenceIds) ? record.source.evidenceIds : []),
    ...(Array.isArray(record.sourceEvidenceId)
      ? record.sourceEvidenceId
      : [record.sourceEvidenceId]),
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

function buildReviewSummary(input: { group: any; accessSignals: any[] }) {
  const allRecords = [...input.accessSignals];
  return {
    totalDerivedRecords: allRecords.length,
    archivedRecords: allRecords.filter((record) => record.archived === true).length,
    recordsMissingEvidence: allRecords.filter((record) => !hasEvidence(record)).length,
    manualLocks: input.group.manuallyLockedFields || [],
    sourceNames: sourceNames(allRecords),
  };
}

async function listAccessReviewEntitiesSnapshot(
  session: mongoose.ClientSession,
  input: AccessReviewListInput = {},
): Promise<{
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
  const sort =
    typeof input.sort === 'string' && ACCESS_REVIEW_SORTS.has(input.sort)
      ? input.sort
      : 'unreviewed';

  const searchTerm = normalizeAccessReviewSearchTerm(input.search);

  if (searchTerm) {
    const searchPrefixes = searchTerm
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, 10)
      .map((term) => term.slice(0, 60));
    filter.searchPrefixes =
      searchPrefixes.length > 0
        ? { $all: searchPrefixes.map((term) => new RegExp(`^${term}`)) }
        : { $in: [] };
  }
  if (hasUnreviewed) filter.totalUnreviewed = { $gt: 0 };
  const sortSpec: Record<string, 1 | -1> =
    sort === 'updated'
      ? { sortUpdatedAt: -1 as const, researchEntityId: 1 as const }
      : sort === 'official_application'
        ? {
            hasOfficialApplication: -1 as const,
            totalUnreviewed: -1 as const,
            sortUpdatedAt: -1 as const,
            researchEntityId: 1 as const,
          }
        : {
            totalUnreviewed: -1 as const,
            hasOfficialApplication: -1 as const,
            sortUpdatedAt: -1 as const,
            researchEntityId: 1 as const,
          };

  await assertAdminAccessReviewProjectionReady(session);
  const projectionQuery = AdminAccessReviewProjection.find(filter)
    .sort(sortSpec)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .select('researchEntityId counts unreviewedCounts totalUnreviewed hasOfficialApplication')
    .session(session)
    .lean();
  // MongoDB does not support parallel operations on one transaction session.
  // Keep every read in this snapshot sequential so the response linearizes
  // wholly before or after a concurrent projection invalidation.
  const groups = await projectionQuery;
  const total = await AdminAccessReviewProjection.countDocuments(filter, { session });
  const progressCounts: Array<{ remaining: number; reviewedToday: number }> = [];
  {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const visibleQueueFilter = { type: { $in: [...accessSignalTypes] } };
    const remaining = await Signal.countDocuments(
      {
        ...visibleQueueFilter,
        $or: [{ 'review.status': 'unreviewed' }, { 'review.status': { $exists: false } }],
      },
      { session },
    );
    const reviewedToday = await Signal.countDocuments(
      {
        ...visibleQueueFilter,
        'review.status': { $ne: 'unreviewed' },
        'review.reviewedAt': { $gte: start },
      },
      { session },
    );
    progressCounts.push({ remaining, reviewedToday });
  }
  const entityIds = groups.map((group: any) => group.researchEntityId);
  const hydrated = entityIds.length
    ? await ResearchEntity.find({ _id: { $in: entityIds } })
        .select(
          'name displayName slug entityType kind departments researchAreas manuallyLockedFields',
        )
        .session(session)
        .lean()
    : [];
  const hydratedById = new Map(
    hydrated.map((entity: any) => [accessReviewDocumentId(entity._id), entity]),
  );

  const entities = groups.flatMap((group: any) => {
    const id = accessReviewDocumentId(group.researchEntityId);
    const entity = hydratedById.get(id);
    if (!entity) return [];
    return {
      _id: id,
      name: entity.displayName || entity.name || '',
      slug: entity.slug || '',
      entityType: entity.entityType,
      kind: entity.kind,
      departments: entity.departments || [],
      researchAreas: entity.researchAreas || [],
      manuallyLockedFields: entity.manuallyLockedFields || [],
      counts: group.counts,
      unreviewedCounts: group.unreviewedCounts,
      totalUnreviewed: Number(group.totalUnreviewed) || 0,
      hasOfficialApplication: group.hasOfficialApplication === true,
    };
  });

  return {
    entities,
    total: Number(total),
    page,
    pageSize,
    totalPages: Math.ceil(Number(total) / pageSize),
    progress: progressCounts.reduce(
      (summary, row) => ({
        remaining: summary.remaining + row.remaining,
        reviewedToday: summary.reviewedToday + row.reviewedToday,
      }),
      { remaining: 0, reviewedToday: 0 },
    ),
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
  return mongoose.connection.transaction(
    (session) => listAccessReviewEntitiesSnapshot(session, input),
    { readConcern: { level: 'snapshot' }, readPreference: 'primary' },
  );
}

export async function getAccessReviewEntity(researchEntityId: string): Promise<any | null> {
  const id = toObjectId(researchEntityId);
  if (!id) return null;

  const [group, accessSignals] = await Promise.all([
    ResearchEntity.findById(id).select('-embedding').lean(),
    Signal.find({ researchEntityId: id, type: { $in: [...accessSignalTypes] } })
      .sort({ archived: 1, observedAt: -1 })
      .lean(),
  ]);

  if (!group) return null;

  return {
    group,
    accessSignals: await attachEvidenceItems(accessSignals),
    reviewSummary: buildReviewSummary({
      group,
      accessSignals,
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

  return mutateAndRefreshAdminAccessReviewProjection(id, async (session) =>
    ResearchEntity.findByIdAndUpdate(
      id,
      { $set: { manuallyLockedFields } },
      { new: true, runValidators: true, session },
    )
      .select('name slug manuallyLockedFields')
      .lean(),
  );
}

function reviewModelForRecordType(type: AccessReviewRecordType): mongoose.Model<any> | null {
  switch (type) {
    case 'accessSignal':
      return Signal;
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
  reviewerNetid?: unknown;
}): Promise<any | null> {
  const model = reviewModelForRecordType(input.type);
  const id = normalizeAccessReviewObjectId(input.id);
  if (!model || !id) return null;

  const projectionRecord = await model.findById(id).select('researchEntityId').lean();
  const projectionEntityId = (projectionRecord as any)?.researchEntityId;

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

  const reviewerAccountId = await resolveReviewerAccountId(input.reviewerNetid);
  if (reviewerAccountId) {
    update['review.reviewedByAccountId'] = reviewerAccountId;
  }

  if (Object.keys(update).length === 0) return null;

  if (update['review.status'] === 'archived_by_review') {
    update.archived = true;
  }

  const mutate = async (session?: mongoose.ClientSession) =>
    model
      .findByIdAndUpdate(
        id,
        { $set: update },
        { new: true, runValidators: true, ...(session ? { session } : {}) },
      )
      .lean();

  return projectionEntityId
    ? mutateAndRefreshAdminAccessReviewProjection(projectionEntityId, mutate)
    : mutate();
}
