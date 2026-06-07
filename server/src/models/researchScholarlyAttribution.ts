/**
 * Attribution from a canonical scholarly link to a Yale person.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const researchScholarlyAttributionSchema = new mongoose.Schema(
  {
    scholarlyLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchScholarlyLink',
      required: true,
      index: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    facultyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacultyMember',
      required: false,
      index: true,
    },
    displayName: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      default: 'author',
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    fieldProvenance: {
      type: Map,
      of: fieldProvenanceSchema,
      default: {},
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
  {
    timestamps: true,
  },
);

researchScholarlyAttributionSchema.index(
  { scholarlyLinkId: 1, targetUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { targetUserId: { $exists: true } },
  },
);
researchScholarlyAttributionSchema.index({ targetUserId: 1, archived: 1 });
researchScholarlyAttributionSchema.index({ facultyMemberId: 1, archived: 1 });

export const ResearchScholarlyAttribution = mongoose.model(
  'ResearchScholarlyAttribution',
  researchScholarlyAttributionSchema,
  'research_scholarly_attributions',
);

export { researchScholarlyAttributionSchema };
