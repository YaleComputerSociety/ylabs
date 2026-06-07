import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument, syncPathwaySearchIndexDocumentsForEntity } from './pathwaySearchIndexService';
import { publicAccessHttpUrl, publicAccessText } from '../utils/publicAccessArtifact';
import type {
  AccessSignalConfidence,
  AccessSignalType,
} from '../models/researchAccessTypes';

export type {
  AccessSignalConfidence,
  AccessSignalType,
} from '../models/researchAccessTypes';

export interface UpsertAccessSignalInput {
  researchEntityId: string;
  signalType: AccessSignalType;
  confidence: AccessSignalConfidence;
  sourceEvidenceId?: string;
  observedAt: Date;
  entryPathwayId?: string;
  excerpt?: string;
  sourceName?: string;
  sourceUrl?: string;
  originalConfidence?: number;
  confidenceScore?: number;
  derivationKey?: string;
  archived?: boolean;
}

export interface AccessSignalServiceDeps {
  model?: mongoose.Model<any>;
}

export interface AccessSignalUpsertResult {
  signalId?: string;
  doc?: any;
}

function getAccessSignalModel(deps: AccessSignalServiceDeps = {}): mongoose.Model<any> {
  return deps.model || AccessSignal;
}

function toStoredId(value: string): unknown {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function toStoredObjectId(value?: string): mongoose.Types.ObjectId | undefined {
  return value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

export async function upsertAccessSignal(
  input: UpsertAccessSignalInput,
  deps: AccessSignalServiceDeps = {},
): Promise<AccessSignalUpsertResult> {
  const AccessSignal = getAccessSignalModel(deps);
  const researchEntityId = toStoredId(input.researchEntityId);
  const entryPathwayId = input.entryPathwayId ? toStoredId(input.entryPathwayId) : undefined;
  const sourceEvidenceId = toStoredObjectId(input.sourceEvidenceId);
  const derivationKey =
    input.derivationKey || `access-materializer:${input.signalType}:${input.sourceEvidenceId}`;

  const filter = compactObject({
    researchEntityId,
    signalType: input.signalType,
    derivationKey,
  });
  const existing = await findReviewLockedRecord(AccessSignal, filter);

  const update = {
    $setOnInsert: compactObject({
      researchEntityId,
      signalType: input.signalType,
      derivationKey,
    }),
    $set: omitReviewLockedFields(compactObject({
      entryPathwayId,
      sourceEvidenceId,
      observationId: sourceEvidenceId,
      confidence: input.confidence,
      confidenceScore: input.confidenceScore ?? input.originalConfidence,
      observedAt: input.observedAt,
      excerpt: publicAccessText(input.excerpt),
      sourceName: input.sourceName,
      sourceUrl: publicAccessHttpUrl(input.sourceUrl),
      originalConfidence: input.originalConfidence,
      archived: input.archived,
      lastMaterializedAt: new Date(),
    }), existing),
  };

  const query = AccessSignal.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  const doc = typeof (query as any).lean === 'function' ? await (query as any).lean() : await query;
  if (!deps.model && process.env.PATHWAY_SEARCH_SYNC === 'true') {
    const sync = doc?.entryPathwayId
      ? syncPathwaySearchIndexDocument(String(doc.entryPathwayId))
      : syncPathwaySearchIndexDocumentsForEntity(String(doc?.researchEntityId || ''));
    await sync.catch((error) => {
      console.error('Failed to sync pathway search index:', error);
    });
  }

  return {
    signalId: doc?._id ? String(doc._id) : undefined,
    doc,
  };
}
