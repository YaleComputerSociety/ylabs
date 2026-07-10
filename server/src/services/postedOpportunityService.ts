import mongoose from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { Listing } from '../models/listing';
import { PostedOpportunity } from '../models/postedOpportunity';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument } from './pathwaySearchIndexService';
import { upsertAccessSignal } from './accessSignalService';
import { upsertEntryPathway } from './entryPathwayService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import type {
  CompensationType,
  EntryPathwayStatus,
  PostedOpportunityStatus,
} from '../models/researchAccessTypes';

export interface UpsertPostedOpportunityInput {
  entryPathwayId: string;
  researchEntityId?: string;
  listingId?: string;
  title: string;
  term?: string;
  deadline?: Date;
  applicationUrl?: string;
  status: PostedOpportunityStatus;
  hoursPerWeek?: number;
  payRate?: string;
  compensationType?: CompensationType;
  eligibility?: string;
  sourceEvidenceIds?: string[];
  sourceUrls?: string[];
  derivationKey?: string;
  archived?: boolean;
}

export interface PostedOpportunityServiceDeps {
  model?: mongoose.Model<any>;
  entryPathwayModel?: mongoose.Model<any>;
  listingModel?: mongoose.Model<any>;
  materializeListing?: typeof materializePostedOpportunityFromListing;
}

function getPostedOpportunityModel(deps: PostedOpportunityServiceDeps = {}): mongoose.Model<any> {
  return deps.model || PostedOpportunity;
}

function getEntryPathwayModel(deps: PostedOpportunityServiceDeps = {}): mongoose.Model<any> {
  return deps.entryPathwayModel || EntryPathway;
}

function getListingModel(deps: PostedOpportunityServiceDeps = {}): mongoose.Model<any> {
  return deps.listingModel || Listing;
}

const STORED_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_POSTED_OPPORTUNITY_SOURCE_URLS = 50;

function toStoredId(value?: unknown): unknown {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (!id) return undefined;
  return STORED_OBJECT_ID_RE.test(id) ? new mongoose.Types.ObjectId(id) : id;
}

function toStoredObjectId(value?: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return STORED_OBJECT_ID_RE.test(id) ? new mongoose.Types.ObjectId(id) : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

function publicPostedOpportunityUrls(values?: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.slice(0, MAX_POSTED_OPPORTUNITY_SOURCE_URLS).flatMap((value) => {
    const url = publicHttpUrl(value);
    return url ? [url] : [];
  });
}

export async function upsertPostedOpportunity(
  input: UpsertPostedOpportunityInput,
  deps: PostedOpportunityServiceDeps = {},
): Promise<{ postedOpportunityId?: string; doc?: any }> {
  const PostedOpportunity = getPostedOpportunityModel(deps);
  const entryPathwayId = toStoredId(input.entryPathwayId);
  if (!entryPathwayId) return {};
  const researchEntityId = toStoredId(input.researchEntityId);
  const listingId = toStoredId(input.listingId);
  const sourceEvidenceIds = (input.sourceEvidenceIds || [])
    .map(toStoredObjectId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const applicationUrl = publicHttpUrl(input.applicationUrl);
  const sourceUrls = publicPostedOpportunityUrls(input.sourceUrls);

  const filter = input.derivationKey
    ? compactObject({ entryPathwayId, derivationKey: input.derivationKey })
    : compactObject({ entryPathwayId, listingId, title: input.title });
  const existing = await findReviewLockedRecord(PostedOpportunity, filter);

  const update = {
    $setOnInsert: compactObject({
      entryPathwayId,
      researchEntityId,
      listingId,
      derivationKey: input.derivationKey,
    }),
    $set: omitReviewLockedFields(
      compactObject({
        title: input.title,
        term: input.term,
        deadline: input.deadline,
        applicationUrl,
        status: input.status,
        hoursPerWeek: input.hoursPerWeek,
        payRate: input.payRate,
        compensationType: input.compensationType,
        eligibility: input.eligibility,
        archived: input.archived ?? input.status === 'ARCHIVED',
      }),
      existing,
    ),
    $addToSet: {
      sourceEvidenceIds: { $each: sourceEvidenceIds },
      sourceUrls: { $each: sourceUrls },
    },
  };

  const query = PostedOpportunity.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  const doc = typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true' && doc?.entryPathwayId) {
    const entryPathwayId = serializedDocumentId(doc.entryPathwayId);
    if (entryPathwayId) await syncPathwaySearchIndexDocument(entryPathwayId).catch((error) => {
      console.error('Failed to sync pathway search index:', sanitizeLogValue(error));
    });
  }

  return {
    postedOpportunityId: serializedDocumentId(doc?._id),
    doc,
  };
}

export interface ListingPostedOpportunityInput {
  _id?: unknown;
  researchEntityId?: unknown;
  researchGroupId?: unknown;
  title?: string;
  websites?: string[];
  expiresAt?: Date | string | null;
  archived?: boolean;
  confirmed?: boolean;
  compensationType?: string;
  applicantDescription?: string;
  updatedAt?: Date | string;
  createdAt?: Date | string;
}

function idToString(value?: unknown): string | undefined {
  return serializedDocumentId(value);
}

function toDate(value?: Date | string | null): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function mapListingCompensationToAccessCompensation(
  compensationType?: string,
): CompensationType {
  switch (compensationType) {
    case 'paid':
      return 'PAID';
    case 'volunteer':
      return 'VOLUNTEER';
    case 'course-credit':
      return 'COURSE_CREDIT';
    case 'fellowship-eligible':
      return 'FELLOWSHIP_ELIGIBLE';
    default:
      return 'UNKNOWN';
  }
}

export function getPostedOpportunityStatusForListing(
  listing: Pick<ListingPostedOpportunityInput, 'archived' | 'confirmed' | 'expiresAt'>,
  now: Date = new Date(),
): PostedOpportunityStatus {
  if (listing.archived === true) return 'ARCHIVED';
  if (listing.confirmed === false) return 'CLOSED';

  const deadline = toDate(listing.expiresAt);
  if (!deadline) return 'ROLLING';
  return deadline.getTime() < now.getTime() ? 'CLOSED' : 'OPEN';
}

export function getEntryPathwayStatusForPostedOpportunity(
  status: PostedOpportunityStatus,
): EntryPathwayStatus {
  if (status === 'OPEN' || status === 'ROLLING') return 'ACTIVE';
  return 'NOT_CURRENTLY_AVAILABLE';
}

function firstUrl(urls?: string[]): string | undefined {
  return (urls || []).find((url) => typeof url === 'string' && url.trim().length > 0)?.trim();
}

export async function materializePostedOpportunityFromListing(
  listing: ListingPostedOpportunityInput,
): Promise<{ entryPathwayId?: string; postedOpportunityId?: string; skipped?: string }> {
  const listingId = idToString(listing._id);
  const researchEntityId = idToString(listing.researchEntityId || listing.researchGroupId);

  if (!listingId) return { skipped: 'missing-listing-id' };
  if (!researchEntityId) return { skipped: 'missing-research-entity-id' };

  const status = getPostedOpportunityStatusForListing(listing);
  const pathwayStatus = getEntryPathwayStatusForPostedOpportunity(status);
  const deadline = toDate(listing.expiresAt);
  const observedAt = toDate(listing.updatedAt) || toDate(listing.createdAt) || new Date();
  const applicationUrl = firstUrl(listing.websites);
  const sourceUrls = (listing.websites || []).filter(Boolean);
  const compensation = mapListingCompensationToAccessCompensation(listing.compensationType);
  const pathwayDerivationKey = `listing:${listingId}:POSTED_ROLE`;
  const signalDerivationKey = `listing:${listingId}:POSTED_OPENING`;
  const opportunityDerivationKey = `listing:${listingId}`;
  const isArchived = listing.archived === true;
  const isActive = status === 'OPEN' || status === 'ROLLING';

  const pathway = await upsertEntryPathway({
    researchEntityId,
    pathwayType: 'POSTED_ROLE',
    status: pathwayStatus,
    evidenceStrength: 'DIRECT',
    studentFacingLabel: 'Posted research role',
    explanation: 'A posted research listing is linked to this research entity.',
    bestNextStep: isActive
      ? 'Apply through the posted listing.'
      : 'This posted listing is not currently available.',
    compensation,
    sourceEvidenceIds: [],
    sourceUrls,
    confidence: 1,
    derivationKey: pathwayDerivationKey,
    archived: isArchived,
    lastObservedAt: observedAt,
  });

  if (!pathway.pathwayId) {
    return { skipped: 'missing-entry-pathway-id' };
  }

  await upsertAccessSignal({
    researchEntityId,
    entryPathwayId: pathway.pathwayId,
    signalType: 'POSTED_OPENING',
    confidence: 'HIGH',
    observedAt,
    excerpt: listing.title ? `Posted listing: ${listing.title}` : 'Posted research listing',
    sourceName: 'ylabs-listing',
    sourceUrl: applicationUrl,
    originalConfidence: 1,
    confidenceScore: 1,
    derivationKey: signalDerivationKey,
    archived: !isActive || isArchived,
  });

  const opportunity = await upsertPostedOpportunity({
    entryPathwayId: pathway.pathwayId,
    researchEntityId,
    listingId,
    title: listing.title || 'Posted research role',
    deadline,
    applicationUrl,
    status,
    compensationType: compensation,
    eligibility: listing.applicantDescription,
    sourceEvidenceIds: [],
    sourceUrls,
    derivationKey: opportunityDerivationKey,
    archived: isArchived || status === 'ARCHIVED',
  });

  return {
    entryPathwayId: pathway.pathwayId,
    postedOpportunityId: opportunity.postedOpportunityId,
  };
}

export interface BackfillPostedOpportunitiesFromListingsOptions {
  now?: Date;
  dryRun?: boolean;
  limit?: number;
}

export interface BackfillPostedOpportunitiesFromListingsResult {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  materialized: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  candidateListingIds: string[];
  materializedListingIds: string[];
}

function activeListingBackfillFilter(now: Date): Record<string, unknown> {
  return {
    archived: { $ne: true },
    confirmed: { $ne: false },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gte: now } }],
  };
}

function incrementReason(target: Record<string, number>, reason?: string): void {
  const key = reason || 'unknown';
  target[key] = (target[key] || 0) + 1;
}

function normalizeMaintenanceLimit(limit: number | undefined): number {
  if (limit === undefined) return 500;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('--limit must be a safe positive integer');
  }
  return limit;
}

export async function backfillPostedOpportunitiesFromListings(
  options: BackfillPostedOpportunitiesFromListingsOptions = {},
  deps: PostedOpportunityServiceDeps = {},
): Promise<BackfillPostedOpportunitiesFromListingsResult> {
  const now = options.now || new Date();
  const dryRun = options.dryRun !== false;
  const limit = normalizeMaintenanceLimit(options.limit);
  const listingModel = getListingModel(deps);
  const postedOpportunityModel = getPostedOpportunityModel(deps);
  const materialize = deps.materializeListing || materializePostedOpportunityFromListing;
  const query = listingModel
    .find(activeListingBackfillFilter(now))
    .select(
      '_id researchEntityId researchGroupId title websites expiresAt archived confirmed compensationType applicantDescription updatedAt createdAt',
    )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit);
  const listings = typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  const listingIds = (listings as any[])
    .flatMap((listing) => idToString(listing._id) ?? []);
  const existingListingIds = new Set(
    (
      await postedOpportunityModel.distinct('listingId', {
        listingId: { $in: listingIds },
        archived: { $ne: true },
      })
    ).flatMap((id) => idToString(id) ?? []),
  );
  const candidates = (listings as ListingPostedOpportunityInput[]).filter(
    (listing) => {
      const listingId = idToString(listing._id);
      return Boolean(listingId && !existingListingIds.has(listingId));
    },
  );
  const skippedReasons: Record<string, number> = {};
  const materializedListingIds: string[] = [];

  if (!dryRun) {
    for (const listing of candidates) {
      const result = await materialize(listing);
      if (result.postedOpportunityId) {
        const listingId = idToString(listing._id);
        if (listingId) materializedListingIds.push(listingId);
      } else {
        incrementReason(skippedReasons, result.skipped);
      }
    }
  }

  return {
    dryRun,
    scanned: (listings as any[]).length,
    candidates: candidates.length,
    materialized: materializedListingIds.length,
    skipped: dryRun ? 0 : candidates.length - materializedListingIds.length,
    skippedReasons,
    candidateListingIds: candidates.flatMap((listing) => idToString(listing._id) ?? []).slice(0, 50),
    materializedListingIds,
  };
}

export interface ReapExpiredPostedOpportunitiesOptions {
  now?: Date;
  dryRun?: boolean;
  limit?: number;
}

export interface ReapExpiredPostedOpportunitiesResult {
  now: string;
  dryRun: boolean;
  expiredCandidates: number;
  closedOpportunities: number;
  skippedLocked: number;
  updatedPathways: number;
  affectedPathwayIds: string[];
}

function hasLockedStatus(record: any): boolean {
  return (
    record?.review?.status === 'archived_by_review' ||
    (record?.review?.lockedFields || []).includes('status')
  );
}

export async function reapExpiredPostedOpportunities(
  options: ReapExpiredPostedOpportunitiesOptions = {},
  deps: PostedOpportunityServiceDeps = {},
): Promise<ReapExpiredPostedOpportunitiesResult> {
  const now = options.now || new Date();
  const dryRun = options.dryRun !== false;
  const limit = normalizeMaintenanceLimit(options.limit);
  const postedOpportunityModel = getPostedOpportunityModel(deps);
  const entryPathwayModel = getEntryPathwayModel(deps);

  const query = postedOpportunityModel
    .find({
      archived: { $ne: true },
      status: 'OPEN',
      deadline: { $lt: now },
    })
    .select('_id entryPathwayId review.status review.lockedFields')
    .sort({ deadline: 1, updatedAt: 1 })
    .limit(limit);
  const expired =
    typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  const affectedPathwayIds = new Set<string>();
  let closedOpportunities = 0;
  let skippedLocked = 0;
  let updatedPathways = 0;

  for (const opportunity of expired as any[]) {
    if (hasLockedStatus(opportunity)) {
      skippedLocked++;
      continue;
    }

    const pathwayId = idToString(opportunity.entryPathwayId);
    if (pathwayId) affectedPathwayIds.add(pathwayId);
    if (dryRun) {
      closedOpportunities++;
      continue;
    }

    const updateResult = await postedOpportunityModel.updateOne(
      { _id: opportunity._id },
      { $set: { status: 'CLOSED' } },
    );
    if ((updateResult as any).modifiedCount || (updateResult as any).matchedCount) {
      closedOpportunities++;
    }
  }

  if (!dryRun) {
    for (const pathwayId of affectedPathwayIds) {
      const activeCount = await postedOpportunityModel.countDocuments({
        entryPathwayId: pathwayId,
        archived: { $ne: true },
        status: { $in: ['OPEN', 'ROLLING'] },
      });
      if (activeCount > 0) continue;

      const pathway = await entryPathwayModel
        .findOne({ _id: pathwayId, archived: { $ne: true }, pathwayType: 'POSTED_ROLE' })
        .select('review.status review.lockedFields')
        .lean();
      if (!pathway || hasLockedStatus(pathway)) continue;

      const updateResult = await entryPathwayModel.updateOne(
        { _id: pathwayId },
        {
          $set: {
            status: 'NOT_CURRENTLY_AVAILABLE',
            bestNextStep: 'This posted listing is not currently available.',
          },
        },
      );
      if ((updateResult as any).modifiedCount || (updateResult as any).matchedCount) {
        updatedPathways++;
      }
    }

    if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true') {
      for (const pathwayId of affectedPathwayIds) {
        await syncPathwaySearchIndexDocument(pathwayId).catch((error) => {
          console.error('Failed to sync pathway search index:', sanitizeLogValue(error));
        });
      }
    }
  }

  return {
    now: now.toISOString(),
    dryRun,
    expiredCandidates: expired.length,
    closedOpportunities,
    skippedLocked,
    updatedPathways,
    affectedPathwayIds: Array.from(affectedPathwayIds),
  };
}
