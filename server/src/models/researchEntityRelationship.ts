import mongoose from 'mongoose';

export const researchEntityRelationshipTypes = [
  'AFFILIATED_LAB',
  'AFFILIATED_RESEARCH_GROUP',
  'MEMBER_RESEARCH_AREA',
  'HOSTED_PROGRAM',
] as const;

export type ResearchEntityRelationshipType =
  (typeof researchEntityRelationshipTypes)[number];

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

