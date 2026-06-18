import mongoose from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument } from './pathwaySearchIndexService';
import { publicAccessHttpUrls, publicAccessText } from '../utils/publicAccessArtifact';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import type {
  CompensationType,
  EntryPathwayStatus,
  EntryPathwayType,
  EvidenceStrength,
} from '../models/researchAccessTypes';

export type {
  CompensationType,
  EntryPathwayStatus,
  EntryPathwayType,
  EvidenceStrength,
} from '../models/researchAccessTypes';

export interface UpsertEntryPathwayInput {
  researchEntityId: string;
  pathwayType: EntryPathwayType;
  status: EntryPathwayStatus;
  evidenceStrength: EvidenceStrength;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: CompensationType;
  sourceEvidenceIds: string[];
  sourceUrls?: string[];
  confidence?: number;
  derivationKey?: string;
  archived?: boolean;
  lastObservedAt?: Date;
  lastMaterializedAt?: Date;
}

export interface EntryPathwayServiceDeps {
  model?: mongoose.Model<any>;
}

export interface EntryPathwayUpsertResult {
  pathwayId?: string;
  doc?: any;
}

function getEntryPathwayModel(deps: EntryPathwayServiceDeps = {}): mongoose.Model<any> {
  return deps.model || EntryPathway;
}

const STORED_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function toStoredId(value: unknown): unknown {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (!id) return undefined;
  return STORED_OBJECT_ID_RE.test(id) ? new mongoose.Types.ObjectId(id) : id;
}

function toStoredObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return STORED_OBJECT_ID_RE.test(id) ? new mongoose.Types.ObjectId(id) : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

export async function upsertEntryPathway(
  input: UpsertEntryPathwayInput,
  deps: EntryPathwayServiceDeps = {},
): Promise<EntryPathwayUpsertResult> {
  const EntryPathway = getEntryPathwayModel(deps);
  const researchEntityId = toStoredId(input.researchEntityId);
  if (!researchEntityId) return {};
  const sourceEvidenceIds = input.sourceEvidenceIds
    .filter(Boolean)
    .map(toStoredObjectId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const sourceUrls = publicAccessHttpUrls(input.sourceUrls || []);
  const now = input.lastMaterializedAt || new Date();
  const derivationKey = input.derivationKey || `access-materializer:${input.pathwayType}`;

  const filter = { researchEntityId, derivationKey };
  const existing = await findReviewLockedRecord(EntryPathway, filter);

  const update = {
    $setOnInsert: {
      researchEntityId,
      pathwayType: input.pathwayType,
      derivationKey,
    },
    $set: omitReviewLockedFields(compactObject({
      status: input.status,
      evidenceStrength: input.evidenceStrength,
      studentFacingLabel: publicAccessText(input.studentFacingLabel),
      explanation: publicAccessText(input.explanation),
      bestNextStep: publicAccessText(input.bestNextStep),
      compensation: input.compensation,
      confidence: input.confidence,
      archived: input.archived,
      lastObservedAt: input.lastObservedAt,
      lastMaterializedAt: now,
    }), existing),
    $addToSet: {
      sourceEvidenceIds: { $each: sourceEvidenceIds },
      sourceUrls: { $each: sourceUrls },
    },
  };

  const query = EntryPathway.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  const doc = typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  const pathwayId = serializedDocumentId(doc?._id);
  if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true' && pathwayId) {
    await syncPathwaySearchIndexDocument(pathwayId).catch((error) => {
      console.error('Failed to sync pathway search index:', sanitizeLogValue(error));
    });
  }

  return {
    pathwayId,
    doc,
  };
}
