/**
 * Mongoose schema and model for ResearchEntity membership with role.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const researchGroupMemberSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    name: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      enum: [
        'pi',
        'co-pi',
        'director',
        'co-director',
        'core-faculty',
        'affiliated',
        'alumni',
        'postdoc',
        'grad-student',
        'undergrad',
        'staff',
        'affiliate',
      ],
      required: true,
    },
    isCurrentMember: {
      type: Boolean,
      default: true,
    },
    joinedAt: {
      type: Date,
      required: false,
    },
    leftAt: {
      type: Date,
      required: false,
    },
    startedAt: {
      type: Date,
      required: false,
    },
    endedAt: {
      type: Date,
      required: false,
    },
    confidenceByField: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    fieldProvenance: {
      type: Map,
      of: fieldProvenanceSchema,
      default: {},
    },
    manuallyLockedFields: {
      type: [String],
      default: [],
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

researchGroupMemberSchema.index({ userId: 1 });
researchGroupMemberSchema.index({ researchEntityId: 1, userId: 1 });
researchGroupMemberSchema.index(
  { researchEntityId: 1, userId: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: {
      researchEntityId: { $exists: true },
      userId: { $exists: true },
      isCurrentMember: true,
    },
  },
);
researchGroupMemberSchema.index({ researchEntityId: 1, role: 1 });

export const ResearchGroupMember = mongoose.model(
  'ResearchGroupMember',
  researchGroupMemberSchema,
  'research_entity_members',
);

export { researchGroupMemberSchema };
