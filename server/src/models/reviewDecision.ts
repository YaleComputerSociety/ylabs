import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const REVIEW_DECISION_SCHEMA_VERSION = defineCanonicalSchemaVersion({
  currentVersion: 1,
});

export const reviewDecisionTargetKinds = [
  'PERSON',
  'ROLE_ASSIGNMENT',
  'RESEARCH_ENTITY',
  'ENTITY_RELATIONSHIP',
  'ENTRY_PATHWAY',
  'POSTED_OPPORTUNITY',
  'SOURCE_DOCUMENT',
  'EVIDENCE_CLAIM',
] as const;
export const reviewDecisionTypes = [
  'APPROVE',
  'REJECT',
  'MERGE',
  'LOCK',
  'SUPPRESS',
  'RESOLVE_IDENTITY',
] as const;

export type ReviewDecisionTargetKind = (typeof reviewDecisionTargetKinds)[number];
export type ReviewDecisionType = (typeof reviewDecisionTypes)[number];

export const MAX_REVIEW_DECISION_RATIONALE_LENGTH = 4_000;
export const MAX_REVIEW_DECISION_INTERNAL_NOTES_LENGTH = 4_000;
export const MAX_REVIEW_DECISION_FIELD_PATHS = 25;
export const MAX_REVIEW_DECISION_FIELD_PATH_LENGTH = 160;
export const MAX_REVIEW_DECISION_EVIDENCE_CLAIMS = 50;

const boundedArray = (maximum: number, label: string) => ({
  validator: (values: unknown[]) => Array.isArray(values) && values.length <= maximum,
  message: `${label} must contain at most ${maximum} items.`,
});

const uniqueArray = (label: string) => ({
  validator: (values: unknown[]) =>
    Array.isArray(values) && new Set(values.map((value) => String(value))).size === values.length,
  message: `${label} must not contain duplicate items.`,
});

const reviewDecisionTargetSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [...reviewDecisionTargetKinds],
      required: true,
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  { _id: false },
);

export const reviewDecisionSchema = new mongoose.Schema<Record<string, unknown>>(
  {
    schemaVersion: canonicalSchemaVersionField(REVIEW_DECISION_SCHEMA_VERSION),
    target: {
      type: reviewDecisionTargetSchema,
      required: true,
      immutable: true,
    },
    decisionType: {
      type: String,
      enum: [...reviewDecisionTypes],
      required: true,
      immutable: true,
      validate: {
        validator(
          this: {
            target?: { kind?: ReviewDecisionTargetKind; id?: unknown };
            replacementTarget?: { kind?: ReviewDecisionTargetKind; id?: unknown };
          },
          decisionType: ReviewDecisionType,
        ) {
          const needsReplacement = decisionType === 'MERGE' || decisionType === 'RESOLVE_IDENTITY';
          if (!needsReplacement) return !this.replacementTarget?.id;
          return (
            Boolean(this.replacementTarget?.id) &&
            this.replacementTarget?.kind === this.target?.kind &&
            String(this.replacementTarget?.id) !== String(this.target?.id)
          );
        },
        message:
          'MERGE and RESOLVE_IDENTITY decisions require a different same-kind replacement target, which other decisions must omit.',
      },
    },
    replacementTarget: {
      type: reviewDecisionTargetSchema,
      required: false,
      immutable: true,
    },
    fieldPaths: {
      type: [
        {
          type: String,
          trim: true,
          minlength: 1,
          maxlength: MAX_REVIEW_DECISION_FIELD_PATH_LENGTH,
        },
      ],
      default: [],
      immutable: true,
      validate: [
        boundedArray(MAX_REVIEW_DECISION_FIELD_PATHS, 'fieldPaths'),
        uniqueArray('fieldPaths'),
      ],
    },
    rationale: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_REVIEW_DECISION_RATIONALE_LENGTH,
      immutable: true,
    },
    internalNotes: {
      type: String,
      default: '',
      maxlength: MAX_REVIEW_DECISION_INTERNAL_NOTES_LENGTH,
      select: false,
      immutable: true,
    },
    evidenceClaimIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'EvidenceClaim',
      default: [],
      immutable: true,
      validate: [
        boundedArray(MAX_REVIEW_DECISION_EVIDENCE_CLAIMS, 'evidenceClaimIds'),
        uniqueArray('evidenceClaimIds'),
      ],
    },
    reviewerAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      select: false,
      immutable: true,
    },
    decidedAt: {
      type: Date,
      default: () => new Date(),
      required: true,
      immutable: true,
    },
    supersedesDecisionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReviewDecision',
      required: false,
      immutable: true,
      validate: {
        validator(
          this: { _id?: mongoose.Types.ObjectId },
          decisionId: mongoose.Types.ObjectId | undefined,
        ) {
          return !decisionId || !this._id?.equals(decisionId);
        },
        message: 'A ReviewDecision cannot supersede itself.',
      },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'review_decisions',
  },
);

reviewDecisionSchema.index({
  'target.kind': 1,
  'target.id': 1,
  decidedAt: -1,
});
reviewDecisionSchema.index({ reviewerAccountId: 1, decidedAt: -1 });
reviewDecisionSchema.index({ evidenceClaimIds: 1 });
reviewDecisionSchema.index(
  { supersedesDecisionId: 1 },
  {
    unique: true,
    partialFilterExpression: { supersedesDecisionId: { $type: 'objectId' } },
  },
);

export const ReviewDecision =
  mongoose.models.ReviewDecision ||
  mongoose.model('ReviewDecision', reviewDecisionSchema, 'review_decisions');
