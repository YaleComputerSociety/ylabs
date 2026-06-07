import mongoose from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument } from './pathwaySearchIndexService';
import { publicAccessHttpUrls, publicAccessText } from '../utils/publicAccessArtifact';
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

function toStoredId(value: string): unknown {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function toStoredObjectId(value: string): mongoose.Types.ObjectId | undefined {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : undefined;
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
  if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true' && doc?._id) {
    await syncPathwaySearchIndexDocument(String(doc._id)).catch((error) => {
      console.error('Failed to sync pathway search index:', error);
    });
  }

  return {
    pathwayId: doc?._id ? String(doc._id) : undefined,
    doc,
  };
}
