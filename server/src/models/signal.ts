/**
 * One source-attributed, typed signal about a research entity.
 *
 * Consolidates the former AccessSignal (undergraduate-access evidence, with a
 * HIGH/MEDIUM/LOW confidence gradient) and UndergraduateLogisticsClaim (KNOWN /
 * STALE_UNDER_REVIEW / CONFLICTING_WITHHELD logistics) into one extensible
 * collection. Future metrics become new `type` values, never new collections.
 *
 * Missing rows are unknown. They must never be interpreted as negative facts,
 * and the materializers must not cross-infer one type from another.
 */
import mongoose from 'mongoose';
import { recordSuppressionSchema } from './modelPrimitives';
import { signalConfidences, signalStatuses, signalTypes } from './researchAccessTypes';

const signalSourceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: '',
    },
    url: {
      type: String,
      default: '',
    },
    excerpt: {
      type: String,
      default: '',
      maxlength: 500,
    },
    evidenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Observation',
      default: [],
    },
    scrapeRunIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'ScrapeRun',
      default: [],
    },
  },
  { _id: false },
);

const signalSchema = new mongoose.Schema(
  {
    // Exactly one of researchEntityId and orgUnitId is set, enforced below. A
    // department-scoped fact such as COURSE_CREDIT_PATHWAY belongs to the
    // department and to nothing smaller (#2214), so it needs a target that is not
    // a research entity. This is an added sibling field rather than the
    // polymorphic `target: { kind, id }` that RoleAssignment uses, because every
    // stored signal is keyed on `researchEntityId` and on the unique partial index
    // over it, so a polymorphic target would be a data migration of the whole
    // collection rather than an additive field.
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      // Conditional `required` rather than a `pre('validate')` hook, because a
      // hook does not run on `validateSync()` and so reported a targetless
      // document as valid.
      required: function (this: { orgUnitId?: unknown }) {
        return !this.orgUnitId;
      },
    },
    orgUnitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrgUnit',
      required: function (this: { researchEntityId?: unknown }) {
        return !this.researchEntityId;
      },
      validate: {
        validator: function (this: { researchEntityId?: unknown }) {
          return !this.researchEntityId;
        },
        message: 'A Signal must target exactly one of researchEntityId or orgUnitId.',
      },
    },
    type: {
      type: String,
      enum: [...signalTypes],
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    confidence: {
      type: String,
      enum: [...signalConfidences],
      required: false,
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
    originalConfidence: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
    status: {
      type: String,
      enum: [...signalStatuses],
      required: false,
    },
    source: {
      type: signalSourceSchema,
      default: () => ({}),
    },
    observedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expiresAt: {
      type: Date,
      required: false,
    },
    derivationKey: {
      type: String,
      required: false,
    },
    lastMaterializedAt: {
      type: Date,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    suppression: {
      type: recordSuppressionSchema,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * The write-site guard. Every real signal write is an `updateOne` upsert, which
 * skips document validation entirely, so the schema rules above are defence for
 * document-shaped writes and this predicate is what an upsert path must call.
 */
export function signalTargetIsExactlyOne(doc: {
  researchEntityId?: unknown;
  orgUnitId?: unknown;
}): boolean {
  return Boolean(doc.researchEntityId) !== Boolean(doc.orgUnitId);
}

signalSchema.index({ researchEntityId: 1 });
signalSchema.index({ orgUnitId: 1 });
signalSchema.index({ type: 1 });
signalSchema.index({ confidence: 1 });
signalSchema.index({ status: 1 });
signalSchema.index({ observedAt: -1 });
signalSchema.index({ expiresAt: 1, archived: 1 });
signalSchema.index({ 'source.evidenceIds': 1 });
signalSchema.index({ 'source.scrapeRunIds': 1 });
signalSchema.index({ archived: 1 });
signalSchema.index(
  { researchEntityId: 1, type: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { derivationKey: { $type: 'string' } },
  },
);
// The org-unit arm needs its own uniqueness guard, because the index above is
// keyed on a field an org-unit signal never sets, so without this one nothing
// would stop a re-run minting a second row for the same derivation key.
signalSchema.index(
  { orgUnitId: 1, type: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orgUnitId: { $exists: true },
      derivationKey: { $type: 'string' },
    },
  },
);

export const Signal = mongoose.model('Signal', signalSchema, 'signals');

export { signalSchema };
