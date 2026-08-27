/**
 * Service layer for untrusted listing claim/correction requests.
 */
import mongoose from 'mongoose';
import { ListingClaimRequest } from '../models/listingClaimRequest';
import { getListingModel } from '../db/connections';
import { BadRequestError, NotFoundError, ObjectIdError } from '../utils/errors';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { runStudentVisibilityGate } from './studentVisibilityGateService';
import { syncEntity } from './meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';
import { resolveReporterIdentityByNetid } from './accountService';
import type { ObservationInput } from '../scrapers/types';

const REQUEST_TYPES = new Set(['claim', 'correction']);
const REQUEST_STATUSES = new Set(['pending', 'changes_requested', 'approved', 'rejected']);

const PROPOSED_CHANGE_FIELDS = [
  'title',
  'hiringStatus',
  'websites',
  'description',
  'applicantDescription',
  'researchAreas',
  'keywords',
  'established',
  'departments',
  'emails',
  'professorIds',
  'professorNames',
  'ownerId',
  'ownerEmail',
  'ownerFirstName',
  'ownerLastName',
  'ownerTitle',
  'ownerPrimaryDepartment',
] as const;

const ARRAY_FIELDS = new Set([
  'websites',
  'researchAreas',
  'keywords',
  'departments',
  'emails',
  'professorIds',
  'professorNames',
]);

const MAX_STRING_LENGTH = 4000;
const MAX_ARRAY_ITEMS = 25;

const RESEARCH_ENTITY_FIELD_MAP: Record<string, string> = {
  title: 'name',
  description: 'fullDescription',
  researchAreas: 'researchAreas',
  departments: 'departments',
};

export type ListingClaimRequestUser = {
  netId?: string;
  email?: string;
  fname?: string;
  lname?: string;
  userType?: string;
  userConfirmed?: boolean;
  profileVerified?: boolean;
};

type ListingClaimSnapshot = {
  title?: string;
  ownerId?: string;
  ownerEmail?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
};

const normalizeRequestBody = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
};

const trimString = (value: unknown, maxLength = MAX_STRING_LENGTH): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
};

const sanitizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .map((item) => trimString(item, 500))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_ARRAY_ITEMS);
  return strings.length > 0 ? strings : [];
};

export const sanitizeProposedChanges = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const source = input as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const field of PROPOSED_CHANGE_FIELDS) {
    if (!(field in source)) continue;

    const value = source[field];
    if (ARRAY_FIELDS.has(field)) {
      const strings = sanitizeStringArray(value);
      if (strings !== undefined) sanitized[field] = strings;
      continue;
    }

    if (field === 'hiringStatus' || field === 'established') {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) sanitized[field] = numberValue;
      continue;
    }

    const stringValue = trimString(value);
    if (stringValue !== undefined) sanitized[field] = stringValue;
  }

  return sanitized;
};

export const sanitizeEvidenceUrls = (input: unknown): string[] => {
  const urls = sanitizeStringArray(input) || [];
  return urls
    .map((url) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.toString().slice(0, 1000);
      } catch {
        return '';
      }
    })
    .filter(Boolean);
};

export const createListingClaimRequest = async (
  listingId: string,
  input: unknown,
  requester: ListingClaimRequestUser,
) => {
  if (!mongoose.Types.ObjectId.isValid(listingId)) {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }

  if (!requester.netId) {
    const error: any = new Error('Authenticated requester is required');
    error.status = 401;
    throw error;
  }

  const body = normalizeRequestBody(input);
  const requestType = body.requestType === undefined ? 'correction' : body.requestType;
  if (typeof requestType !== 'string' || !REQUEST_TYPES.has(requestType)) {
    throw new BadRequestError('Invalid request type');
  }

  const message = trimString(body.message);
  if (!message) {
    throw new BadRequestError('Message is required');
  }

  const listing = (await getListingModel()
    .findById(listingId)
    .select('-embedding')
    .lean()) as ListingClaimSnapshot | null;
  if (!listing) {
    throw new NotFoundError(`Listing not found with ObjectId: ${listingId}`);
  }

  const existingPending = await ListingClaimRequest.findOne({
    listingId,
    requestType,
    'requester.netId': requester.netId,
    status: 'pending',
  })
    .select('_id')
    .lean();
  if (existingPending) {
    const error: any = new Error('A pending request of this type already exists for this listing');
    error.status = 409;
    throw error;
  }

  const providedName = [requester.fname, requester.lname].filter(Boolean).join(' ');
  const identity =
    requester.email && providedName
      ? { email: requester.email, name: providedName }
      : await resolveReporterIdentityByNetid(requester.netId);

  const request = await ListingClaimRequest.create({
    listingId,
    requestType,
    requester: {
      netId: requester.netId,
      email: requester.email || identity.email,
      name: providedName || identity.name,
      userType: requester.userType || 'unknown',
      userConfirmed: Boolean(requester.userConfirmed),
      profileVerified: Boolean(requester.profileVerified),
    },
    listingSnapshot: {
      title: listing.title || '',
      ownerId: listing.ownerId || '',
      ownerEmail: listing.ownerEmail || '',
      ownerName: [listing.ownerFirstName, listing.ownerLastName].filter(Boolean).join(' '),
    },
    message,
    proposedChanges: sanitizeProposedChanges(body.proposedChanges),
    evidenceUrls: sanitizeEvidenceUrls(body.evidenceUrls),
  });

  console.info(
    `Listing ${requestType} request ${request._id} submitted for ${listingId} by ${requester.netId}`,
  );

  return request.toObject();
};

export const listListingClaimRequests = async (params: {
  status?: string;
  requestType?: string;
  listingId?: string;
  page?: string;
  pageSize?: string;
  requesterNetId?: string;
}) => {
  const filter: Record<string, unknown> = {};

  if (params.status && REQUEST_STATUSES.has(params.status)) filter.status = params.status;
  if (params.requestType && REQUEST_TYPES.has(params.requestType)) {
    filter.requestType = params.requestType;
  }
  if (params.listingId) {
    if (!mongoose.Types.ObjectId.isValid(params.listingId)) {
      throw new ObjectIdError('Did not received expected id type ObjectId');
    }
    filter.listingId = params.listingId;
  }
  if (params.requesterNetId) filter['requester.netId'] = params.requesterNetId;

  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize || '25', 10) || 25));

  const [requests, total] = await Promise.all([
    ListingClaimRequest.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ListingClaimRequest.countDocuments(filter),
  ]);

  return {
    requests,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

export const reviewListingClaimRequest = async (
  id: string,
  reviewerNetId: string,
  input: unknown,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }

  const body = normalizeRequestBody(input);
  const status = body.status;
  if (typeof status !== 'string' || !REQUEST_STATUSES.has(status) || status === 'pending') {
    throw new BadRequestError('Status must be approved, rejected, or changes_requested');
  }

  const rationale = trimString(body.adminNotes);
  if (!rationale) throw new BadRequestError('Reviewer rationale is required');
  const reviewedAt = new Date();

  const request = await ListingClaimRequest.findByIdAndUpdate(
    { _id: id, status: { $in: ['pending', 'changes_requested'] } },
    {
      status,
      adminNotes: rationale,
      reviewedBy: reviewerNetId,
      reviewedAt,
      $push: { reviewHistory: { status, rationale, reviewedBy: reviewerNetId, reviewedAt } },
    },
    { new: true, runValidators: true },
  ).lean();

  if (!request) {
    throw new NotFoundError(`Open listing claim request not found with ObjectId: ${id}`);
  }

  return request;
};

export const applyListingClaimRequestDecision = async (
  id: string,
  adminNetId: string,
  input: unknown,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }

  const body = normalizeRequestBody(input);
  if (body.confirmApply !== true) {
    throw new BadRequestError('Explicit confirmation is required to apply canonical data changes');
  }

  const request = await ListingClaimRequest.findById(id);
  if (!request) {
    throw new NotFoundError(`Listing claim request not found with ObjectId: ${id}`);
  }

  if (request.applyStatus === 'applied') {
    return request.toObject();
  }

  if (request.status !== 'approved') {
    throw new BadRequestError('Only approved requests can be applied to canonical data');
  }

  const mappedFields = Object.entries(
    (request.proposedChanges as Record<string, unknown>) || {},
  ).filter(([field]) => RESEARCH_ENTITY_FIELD_MAP[field]);

  const markApplied = async (patch: Record<string, unknown>) => {
    request.set({ appliedAt: new Date(), appliedBy: adminNetId, ...patch });
    await request.save();
    return request.toObject();
  };

  if (mappedFields.length === 0) {
    return markApplied({ applyStatus: 'not_applicable', appliedFields: [], applyError: '' });
  }

  const listing = (await getListingModel()
    .findById(request.listingId)
    .select('researchEntityId')
    .lean()) as { researchEntityId?: unknown } | null;
  const researchEntityId = listing?.researchEntityId
    ? serializedDocumentId(listing.researchEntityId)
    : undefined;

  if (!researchEntityId) {
    return markApplied({
      applyStatus: 'failed',
      applyError: 'No linked canonical research entity to apply changes to.',
    });
  }

  const source = await getSourceByName('manual-admin-edit');
  if (!source) {
    throw new Error('No Source row found for "manual-admin-edit". Run "yarn seed:sources" first.');
  }

  const run = await ScrapeRun.create({
    sourceId: source._id,
    sourceName: source.name,
    triggeredBy: 'admin',
    startedAt: new Date(),
    status: 'running',
    options: { listingClaimRequestId: String(request._id) },
  });
  const scrapeRunId = serializedDocumentId(run._id) || '';

  const observationInputs: ObservationInput[] = mappedFields.map(([field, value]) => ({
    entityType: 'researchEntity',
    entityId: researchEntityId,
    field: RESEARCH_ENTITY_FIELD_MAP[field],
    value,
  }));

  try {
    await appendObservations(observationInputs, {
      scrapeRunId,
      sourceId: source._id,
      sourceName: source.name,
      sourceWeight: source.defaultWeight,
      dryRun: false,
    });
    await materializeEntity('researchEntity', { entityId: researchEntityId });
    await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: [researchEntityId],
    });
    const freshEntity = await ResearchEntity.findById(researchEntityId).lean();
    if (freshEntity) await syncEntity('researchEntity', freshEntity);

    await ScrapeRun.updateOne(
      { _id: run._id },
      {
        $set: {
          finishedAt: new Date(),
          status: 'success',
          observationCount: observationInputs.length,
          entitiesObserved: 1,
        },
      },
    );

    return markApplied({
      applyStatus: 'applied',
      appliedFields: mappedFields.map(([field]) => field),
      applyError: '',
    });
  } catch (error: any) {
    await ScrapeRun.updateOne(
      { _id: run._id },
      {
        $set: {
          finishedAt: new Date(),
          status: 'failure',
          errors: [{ message: error?.message || 'Apply failed', at: new Date() }],
        },
      },
    );
    return markApplied({
      applyStatus: 'failed',
      applyError: error?.message || 'Failed to apply canonical data changes.',
    });
  }
};
