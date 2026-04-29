/**
 * Mongoose schema and model for ResearchGroup ↔ User membership with role.
 */
import mongoose from 'mongoose';

const researchGroupMemberSchema = new mongoose.Schema(
  {
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'researchgroups',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    role: {
      type: String,
      enum: ['pi', 'co-pi', 'director', 'co-director', 'core-faculty', 'affiliated', 'alumni'],
      required: true,
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

researchGroupMemberSchema.index({ researchGroupId: 1, userId: 1 }, { unique: true });
researchGroupMemberSchema.index({ userId: 1 });
researchGroupMemberSchema.index({ researchGroupId: 1, role: 1 });

export const ResearchGroupMember = mongoose.model(
  'researchgroupmembers',
  researchGroupMemberSchema,
);

export { researchGroupMemberSchema };
