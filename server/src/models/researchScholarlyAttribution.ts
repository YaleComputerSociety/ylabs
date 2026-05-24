import mongoose from 'mongoose';

export const scholarlyAttributionRelationshipBases = [
  'identity_authorship',
  'explicit_entity_link',
  'official_profile_publication',
  'manual',
] as const;

export type ScholarlyAttributionRelationshipBasis =
  (typeof scholarlyAttributionRelationshipBases)[number];

const researchScholarlyAttributionSchema = new mongoose.Schema(
  {
    scholarlyLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchScholarlyLink',
      required: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    targetResearchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    relationshipBasis: {
      type: String,
      enum: [...scholarlyAttributionRelationshipBases],
      required: true,
    },
    evidenceLabel: {
      type: String,
      required: true,
      trim: true,
    },
    sourceName: {
      type: String,
      default: '',
      trim: true,
    },
    sourceUrl: {
      type: String,
      default: '',
      trim: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.7,
    },
    observedAt: {
      type: Date,
      default: () => new Date(),
    },
    derivationKey: {
      type: String,
      required: true,
      trim: true,
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

researchScholarlyAttributionSchema.pre('validate', function validateTarget(next) {
  if (!this.targetUserId && !this.targetResearchEntityId) {
    next(
      new Error(
        'ResearchScholarlyAttribution requires targetUserId or targetResearchEntityId',
      ),
    );
    return;
  }
  next();
});

researchScholarlyAttributionSchema.index({ scholarlyLinkId: 1, archived: 1 });
researchScholarlyAttributionSchema.index({ targetUserId: 1, archived: 1 });
researchScholarlyAttributionSchema.index({ targetResearchEntityId: 1, archived: 1 });
researchScholarlyAttributionSchema.index({ relationshipBasis: 1 });
researchScholarlyAttributionSchema.index(
  {
    scholarlyLinkId: 1,
    targetUserId: 1,
    targetResearchEntityId: 1,
    relationshipBasis: 1,
    derivationKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: { archived: false },
  },
);

export const ResearchScholarlyAttribution = mongoose.model(
  'ResearchScholarlyAttribution',
  researchScholarlyAttributionSchema,
  'research_scholarly_attributions',
);

export { researchScholarlyAttributionSchema };
