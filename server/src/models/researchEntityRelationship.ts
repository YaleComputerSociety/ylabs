import mongoose from 'mongoose';

/**
 * Only these two are reachable. `centersInstitutesScraper` hard-codes
 * MEMBER_RESEARCH_AREA as the sole observed value and
 * `centerRelationshipTypeForResolvedTarget` can only upgrade it to
 * AFFILIATED_LAB, so AFFILIATED_RESEARCH_GROUP and HOSTED_PROGRAM were
 * unreachable with 0 edges in every environment and were dropped (#2213).
 */
export const researchEntityRelationshipTypes = ['AFFILIATED_LAB', 'MEMBER_RESEARCH_AREA'] as const;

const researchEntityRelationshipSchema = new mongoose.Schema(
  {
    sourceResearchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    targetResearchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    relationshipType: {
      type: String,
      enum: [...researchEntityRelationshipTypes],
      required: true,
    },
    label: {
      type: String,
      default: '',
    },
    evidenceStrength: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    evidenceQuote: {
      type: String,
      default: '',
    },
    confidence: {
      type: Number,
      required: false,
    },
    lastObservedAt: {
      type: Date,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

researchEntityRelationshipSchema.index({ sourceResearchEntityId: 1, relationshipType: 1 });
researchEntityRelationshipSchema.index({ targetResearchEntityId: 1, relationshipType: 1 });

export const ResearchEntityRelationship =
  mongoose.models.ResearchEntityRelationship ||
  mongoose.model(
    'ResearchEntityRelationship',
    researchEntityRelationshipSchema,
    'research_entity_relationships',
  );
