import mongoose from 'mongoose';
import { Signal } from '../models/signal';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import {
  syncPathwaySearchIndexDocument,
  syncPathwaySearchIndexDocumentsForEntity,
} from './pathwaySearchIndexService';
import { publicAccessHttpUrl, publicAccessText } from '../utils/publicAccessArtifact';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import { mutateAndRefreshAdminAccessReviewProjection } from './adminAccessReviewProjectionService';
import type { SignalConfidence, SignalType } from '../models/researchAccessTypes';

export type { SignalConfidence, SignalType } from '../models/researchAccessTypes';

export interface UpsertSignalInput {
  researchEntityId: string;
  type: SignalType;
  confidence: SignalConfidence;
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

export interface SignalServiceDeps {
  model?: mongoose.Model<any>;
}

export interface SignalUpsertResult {
  signalId?: string;
  doc?: any;
}

function getSignalModel(deps: SignalServiceDeps = {}): mongoose.Model<any> {
  return deps.model || Signal;
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

export async function upsertSignal(
  input: UpsertSignalInput,
  deps: SignalServiceDeps = {},
): Promise<SignalUpsertResult> {
  const Signal = getSignalModel(deps);
  const researchEntityId = toStoredId(input.researchEntityId);
  if (!researchEntityId) return {};
  const entryPathwayId = input.entryPathwayId ? toStoredId(input.entryPathwayId) : undefined;
  const sourceEvidenceId = toStoredObjectId(input.sourceEvidenceId);
  const derivationKey =
    input.derivationKey || `access-materializer:${input.type}:${input.sourceEvidenceId}`;

  const filter = compactObject({
    researchEntityId,
    type: input.type,
    derivationKey,
  });
  const existing = await findReviewLockedRecord(Signal, filter);

  const update = {
    $setOnInsert: compactObject({
      researchEntityId,
      type: input.type,
      derivationKey,
    }),
    $set: omitReviewLockedFields(
      compactObject({
        entryPathwayId,
        'source.evidenceIds': sourceEvidenceId ? [sourceEvidenceId] : undefined,
        'source.name': input.sourceName,
        'source.url': publicAccessHttpUrl(input.sourceUrl),
        'source.excerpt': publicAccessText(input.excerpt),
        confidence: input.confidence,
        confidenceScore: input.confidenceScore ?? input.originalConfidence,
        observedAt: input.observedAt,
        originalConfidence: input.originalConfidence,
        archived: input.archived,
        lastMaterializedAt: new Date(),
      }),
      existing,
    ),
  };

  const write = async (session?: mongoose.ClientSession) => {
    const query = Signal.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      ...(session ? { session } : {}),
    });
    return typeof (query as any).lean === 'function' ? (query as any).lean() : query;
  };
  const doc = deps.model
    ? await write()
    : await mutateAndRefreshAdminAccessReviewProjection(researchEntityId, write);
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
