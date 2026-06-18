import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { syncPathwaySearchIndexDocument, syncPathwaySearchIndexDocumentsForEntity } from './pathwaySearchIndexService';
import { publicAccessHttpUrl, publicAccessText } from '../utils/publicAccessArtifact';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
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

const STORED_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function toStoredId(value: unknown): unknown {
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
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

export async function upsertAccessSignal(
  input: UpsertAccessSignalInput,
  deps: AccessSignalServiceDeps = {},
): Promise<AccessSignalUpsertResult> {
  const AccessSignal = getAccessSignalModel(deps);
  const researchEntityId = toStoredId(input.researchEntityId);
  if (!researchEntityId) return {};
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
    const entryPathwayId = serializedDocumentId(doc?.entryPathwayId);
    const researchEntityId = serializedDocumentId(doc?.researchEntityId);
    const sync = entryPathwayId
      ? syncPathwaySearchIndexDocument(entryPathwayId)
      : researchEntityId
        ? syncPathwaySearchIndexDocumentsForEntity(researchEntityId)
        : undefined;
    if (sync) {
      await sync.catch((error) => {
        console.error('Failed to sync pathway search index:', sanitizeLogValue(error));
      });
    }
  }

  return {
    signalId: serializedDocumentId(doc?._id),
    doc,
  };
}
