import mongoose from 'mongoose';
import { evidenceStrengths } from './researchAccessTypes';

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
    evidenceStrength: {
      type: String,
      enum: [...evidenceStrengths],
      default: 'MODERATE',
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
      min: 0,
      max: 1,
      default: 0.7,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    lastObservedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

researchEntityRelationshipSchema.index(
  {
    sourceResearchEntityId: 1,
    targetResearchEntityId: 1,
    relationshipType: 1,
  },
  { unique: true },
);
researchEntityRelationshipSchema.index({ sourceResearchEntityId: 1, archived: 1 });
researchEntityRelationshipSchema.index({ targetResearchEntityId: 1, archived: 1 });

export const ResearchEntityRelationship = mongoose.model(
  'ResearchEntityRelationship',
  researchEntityRelationshipSchema,
  'research_entity_relationships',
);

export { researchEntityRelationshipSchema };
