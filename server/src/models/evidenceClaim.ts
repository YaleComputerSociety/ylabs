// FROZEN: unwired evidence claim-graph contract - exists, do not build on it.
// No live readers, writers, materializers, or Meilisearch projections. The heavy
// governed evidence claim-graph is deferred; the live Observation -> Signal
// pipeline covers the product. Wiring this re-opens the deferred claim-graph, so
// coordinate first. See docs/research-model-refactor.md (Removed, frozen, retired).
import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';
import {
  EVIDENCE_PREDICATE_REGISTRY_VERSION,
  evidenceClaimPredicates,
  evidenceClaimSubjectKinds,
  evidencePredicateSupportsSubject,
  isEvidenceClaimPredicate,
  type EvidenceClaimSubjectKind,
} from './evidencePredicateRegistry';

export const EVIDENCE_CLAIM_SCHEMA_VERSION = defineCanonicalSchemaVersion({
  currentVersion: 1,
});

export const evidenceClaimSensitivities = ['PUBLIC', 'AUTHENTICATED', 'ADMIN_ONLY'] as const;
export const evidenceClaimStatuses = ['ACTIVE', 'SUPERSEDED', 'REJECTED', 'DISPUTED'] as const;

export type EvidenceClaimSensitivity = (typeof evidenceClaimSensitivities)[number];
export type EvidenceClaimStatus = (typeof evidenceClaimStatuses)[number];

export const MAX_EVIDENCE_CLAIM_SUBJECT_KEY_LENGTH = 512;
export const MAX_EVIDENCE_CLAIM_EXCERPT_LENGTH = 2_000;
export const MAX_EVIDENCE_CLAIM_VALUE_STRING_LENGTH = 4_000;
export const MAX_EVIDENCE_CLAIM_VALUE_COLLECTION_ITEMS = 50;
export const MAX_EVIDENCE_CLAIM_VALUE_DEPTH = 6;
export const MAX_EVIDENCE_CLAIM_VALUE_NODES = 250;
export const MAX_EVIDENCE_CLAIM_OBJECT_KEY_LENGTH = 120;

interface ValueValidationState {
  nodes: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isBoundedEvidenceClaimValue(
  value: unknown,
  depth = 0,
  state: ValueValidationState = { nodes: 0 },
): boolean {
  state.nodes += 1;
  if (state.nodes > MAX_EVIDENCE_CLAIM_VALUE_NODES || depth > MAX_EVIDENCE_CLAIM_VALUE_DEPTH) {
    return false;
  }
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_EVIDENCE_CLAIM_VALUE_STRING_LENGTH;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (value instanceof mongoose.Types.ObjectId) return true;
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_EVIDENCE_CLAIM_VALUE_COLLECTION_ITEMS &&
      value.every((item) => isBoundedEvidenceClaimValue(item, depth + 1, state))
    );
  }
  if (!isPlainRecord(value)) return false;

  const entries = Object.entries(value);
  return (
    entries.length <= MAX_EVIDENCE_CLAIM_VALUE_COLLECTION_ITEMS &&
    entries.every(
      ([key, item]) =>
        key.length <= MAX_EVIDENCE_CLAIM_OBJECT_KEY_LENGTH &&
        isBoundedEvidenceClaimValue(item, depth + 1, state),
    )
  );
}

const evidenceClaimSubjectSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [...evidenceClaimSubjectKinds],
      required: true,
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    key: {
      type: String,
      trim: true,
      maxlength: MAX_EVIDENCE_CLAIM_SUBJECT_KEY_LENGTH,
      required: false,
    },
  },
  { _id: false },
);

export const evidenceClaimSchema = new mongoose.Schema<Record<string, unknown>>(
  {
    schemaVersion: canonicalSchemaVersionField(EVIDENCE_CLAIM_SCHEMA_VERSION),
    predicateRegistryVersion: {
      type: Number,
      enum: [EVIDENCE_PREDICATE_REGISTRY_VERSION],
      default: EVIDENCE_PREDICATE_REGISTRY_VERSION,
      required: true,
    },
    subject: {
      type: evidenceClaimSubjectSchema,
      required: true,
      validate: {
        validator: (subject: { id?: unknown; key?: string }) =>
          Boolean(subject?.id || subject?.key?.trim()),
        message: 'subject must identify a canonical id or stable key.',
      },
    },
    predicate: {
      type: String,
      enum: [...evidenceClaimPredicates],
      required: true,
      validate: {
        validator(this: { subject?: { kind?: EvidenceClaimSubjectKind } }, predicate: unknown) {
          return (
            isEvidenceClaimPredicate(predicate) &&
            Boolean(this.subject?.kind) &&
            evidencePredicateSupportsSubject(predicate, this.subject!.kind!)
          );
        },
        message: 'predicate is not supported for the selected subject kind.',
      },
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      select: false,
      validate: {
        validator: (value: unknown) => isBoundedEvidenceClaimValue(value),
        message: 'value exceeds the bounded EvidenceClaim value contract.',
      },
    },
    excerpt: {
      type: String,
      default: '',
      maxlength: MAX_EVIDENCE_CLAIM_EXCERPT_LENGTH,
      select: false,
    },
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SourceDocument',
      required: true,
    },
    observedAt: {
      type: Date,
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    sensitivity: {
      type: String,
      enum: [...evidenceClaimSensitivities],
      default: 'ADMIN_ONLY',
      required: true,
    },
    status: {
      type: String,
      enum: [...evidenceClaimStatuses],
      default: 'ACTIVE',
      required: true,
      validate: {
        validator(
          this: {
            _id?: mongoose.Types.ObjectId;
            supersededByClaimId?: mongoose.Types.ObjectId;
          },
          status: EvidenceClaimStatus,
        ) {
          if (status !== 'SUPERSEDED') return !this.supersededByClaimId;
          if (!this.supersededByClaimId) return false;
          return !this._id?.equals(this.supersededByClaimId);
        },
        message:
          'supersededByClaimId must identify another claim and is allowed only for SUPERSEDED status.',
      },
    },
    supersededByClaimId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EvidenceClaim',
      required: false,
      validate: {
        validator(
          this: { _id?: mongoose.Types.ObjectId },
          claimId: mongoose.Types.ObjectId | undefined,
        ) {
          return !claimId || !this._id?.equals(claimId);
        },
        message: 'An EvidenceClaim cannot supersede itself.',
      },
    },
  },
  {
    timestamps: true,
    collection: 'evidence_claims',
  },
);

evidenceClaimSchema.index({
  'subject.kind': 1,
  'subject.id': 1,
  predicate: 1,
  status: 1,
  observedAt: -1,
});
evidenceClaimSchema.index({
  'subject.kind': 1,
  'subject.key': 1,
  predicate: 1,
  status: 1,
  observedAt: -1,
});
evidenceClaimSchema.index({ sourceDocumentId: 1, observedAt: -1 });
evidenceClaimSchema.index({ predicate: 1, status: 1, observedAt: -1 });
evidenceClaimSchema.index({ supersededByClaimId: 1 });

export const EvidenceClaim =
  mongoose.models.EvidenceClaim ||
  mongoose.model('EvidenceClaim', evidenceClaimSchema, 'evidence_claims');
