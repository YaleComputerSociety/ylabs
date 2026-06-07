import mongoose from 'mongoose';

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

