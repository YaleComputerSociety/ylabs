import mongoose from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument } from './pathwaySearchIndexService';
import { upsertAccessSignal } from './accessSignalService';
import { upsertEntryPathway } from './entryPathwayService';
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
}

function getPostedOpportunityModel(deps: PostedOpportunityServiceDeps = {}): mongoose.Model<any> {
  return deps.model || PostedOpportunity;
}

function getEntryPathwayModel(deps: PostedOpportunityServiceDeps = {}): mongoose.Model<any> {
  return deps.entryPathwayModel || EntryPathway;
}

function toStoredId(value?: string): unknown {
  if (!value) return undefined;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function toStoredObjectId(value?: string): mongoose.Types.ObjectId | undefined {
  return value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

export async function upsertPostedOpportunity(
  input: UpsertPostedOpportunityInput,
  deps: PostedOpportunityServiceDeps = {},
): Promise<{ postedOpportunityId?: string; doc?: any }> {
  const PostedOpportunity = getPostedOpportunityModel(deps);
  const entryPathwayId = toStoredId(input.entryPathwayId);
  const researchEntityId = toStoredId(input.researchEntityId);
  const listingId = toStoredId(input.listingId);
  const sourceEvidenceIds = (input.sourceEvidenceIds || [])
    .map(toStoredObjectId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);

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
        applicationUrl: input.applicationUrl,
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
      sourceUrls: { $each: input.sourceUrls || [] },
    },
  };

  const query = PostedOpportunity.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  const doc = typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true' && doc?.entryPathwayId) {
    await syncPathwaySearchIndexDocument(String(doc.entryPathwayId)).catch((error) => {
      console.error('Failed to sync pathway search index:', error);
    });
  }

  return {
    postedOpportunityId: doc?._id ? String(doc._id) : undefined,
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
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof (value as { toString?: unknown }).toString === 'function') {
    return String(value);
  }
  return undefined;
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
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : 500;
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

    const pathwayId = String(opportunity.entryPathwayId || '');
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
          console.error('Failed to sync pathway search index:', error);
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
