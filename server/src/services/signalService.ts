import mongoose from 'mongoose';
import { Signal } from '../models/signal';
import { findReviewLockedRecord, omitReviewLockedFields } from './reviewLockUtils';
import { publicAccessHttpUrl } from '../utils/publicAccessArtifact';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { withResearchEntityWriteTransaction } from './researchEntityWriteTransaction';
import type { SignalConfidence, SignalType } from '../models/researchAccessTypes';

export type { SignalConfidence, SignalType } from '../models/researchAccessTypes';

export interface UpsertSignalInput {
  researchEntityId: string;
  type: SignalType;
  confidence: SignalConfidence;
  sourceEvidenceId?: string;
  observedAt: Date;
  expiresAt?: Date;
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
        'source.evidenceIds': sourceEvidenceId ? [sourceEvidenceId] : undefined,
        'source.name': input.sourceName,
        'source.url': publicAccessHttpUrl(input.sourceUrl),
        'source.excerpt': sanitizeEvidenceExcerpt(input.excerpt ?? '') || undefined,
        confidence: input.confidence,
        confidenceScore: input.confidenceScore ?? input.originalConfidence,
        observedAt: input.observedAt,
        expiresAt: input.expiresAt,
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
    : await withResearchEntityWriteTransaction(write);

  return {
    signalId: serializedDocumentId(doc?._id),
    doc,
  };
}
