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

export interface AccessReviewListInput {
  search?: string;
  page?: number;
  pageSize?: number;
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

function toObjectId(id: unknown): mongoose.Types.ObjectId | null {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

function normalizePage(input?: number): number {
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(input) || 1)));
}

function normalizePageSize(input?: number): number {
  return Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(input) || DEFAULT_PAGE_SIZE)),
  );
}

export function normalizeAccessReviewSearchTerm(input?: string): string {
  const searchTerm = input?.trim() || '';
  if (searchTerm.length > MAX_ACCESS_REVIEW_SEARCH_QUERY_LENGTH) {
    throw new Error('Search query is too long');
  }
  return searchTerm;
}

async function countByEntity(
  model: mongoose.Model<any>,
  ids: mongoose.Types.ObjectId[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await model
    .aggregate([
      { $match: { researchEntityId: { $in: ids } } },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ])
    .exec();
  return new Map(rows.map((row: any) => [String(row._id), Number(row.count) || 0]));
}

function zeroCounts(): AccessReviewCountSummary {
  return {
    entryPathways: 0,
    accessSignals: 0,
    contactRoutes: 0,
    postedOpportunities: 0,
  };
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
  return Array.from(
    new Set(
      rawIds
        .map((id) => String(id || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ).map((id) => new mongoose.Types.ObjectId(id));
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
  const recordIds = records.map((record) => String(record._id));
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
  const byId = new Map(observations.map((obs: any) => [String(obs._id), obs]));

  return new Map(
    recordIds.map((recordId) => [
      recordId,
      (idsByRecordId.get(recordId) || [])
        .map((id) => byId.get(String(id)))
        .filter(Boolean)
        .map((obs: any) => ({
          observationId: String(obs._id),
          sourceName: obs.sourceName,
          sourceUrl: obs.sourceUrl,
          scrapeRunId: obs.scrapeRunId ? String(obs.scrapeRunId) : undefined,
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
    evidenceItems: evidenceByRecordId.get(String(record._id)) || [],
  }));
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
}> {
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const filter: Record<string, unknown> = {};

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

  const [groups, total] = await Promise.all([
    ResearchEntity.find(filter)
      .select('name displayName slug entityType kind departments researchAreas manuallyLockedFields updatedAt')
      .sort({ updatedAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ResearchEntity.countDocuments(filter),
  ]);

  const ids = groups
    .map((group: any) => toObjectId(group._id))
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const [pathwayCounts, signalCounts, routeCounts, opportunityCounts] = await Promise.all([
    countByEntity(EntryPathway, ids),
    countByEntity(AccessSignal, ids),
    countByEntity(ContactRoute, ids),
    countByEntity(PostedOpportunity, ids),
  ]);

  const entities = groups.map((group: any) => {
    const id = String(group._id);
    const counts = zeroCounts();
    counts.entryPathways = pathwayCounts.get(id) || 0;
    counts.accessSignals = signalCounts.get(id) || 0;
    counts.contactRoutes = routeCounts.get(id) || 0;
    counts.postedOpportunities = opportunityCounts.get(id) || 0;

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
    };
  });

  return {
    entities,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
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
    contactRoutes: await attachEvidenceItems(contactRoutes),
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
  if (!id || !Array.isArray(fields)) return null;

  const manuallyLockedFields = Array.from(
    new Set(
      fields
        .map((field) => (typeof field === 'string' ? field.trim() : ''))
        .filter((field) => field.length > 0)
        .slice(0, 100),
    ),
  );

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
  const id = toObjectId(input.id);
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
    update['review.lockedFields'] = Array.from(
      new Set(
        input.lockedFields
          .map((field) => (typeof field === 'string' ? field.trim() : ''))
          .filter(Boolean)
          .slice(0, 100),
      ),
    );
  }

  if (input.reviewerId && mongoose.Types.ObjectId.isValid(String(input.reviewerId))) {
    update['review.reviewedByUserId'] = new mongoose.Types.ObjectId(String(input.reviewerId));
  }

  if (Object.keys(update).length === 0) return null;

  if (update['review.status'] === 'archived_by_review') {
    update.archived = true;
  }

  return model
    .findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })
    .lean();
}
