/**
 * Mongoose schema and model for a student's private relationship to a research group.
 */
import mongoose from 'mongoose';

const stageHistorySchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  { _id: false },
);

const studentTrackingSchema = new mongoose.Schema(
  {
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
    },
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchGroup',
      required: false,
    },
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    stage: {
      type: String,
      enum: [
        'interested',
        'reached-out',
        'waiting',
        'in-conversation',
        'joined',
        'not-a-fit',
        'archived',
      ],
      default: 'interested',
    },
    stageHistory: {
      type: [stageHistorySchema],
      default: [],
    },
    privateNotes: {
      type: String,
      default: '',
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

studentTrackingSchema.index(
  { studentProfileId: 1, researchGroupId: 1 },
  { unique: true },
);
studentTrackingSchema.index(
  { studentProfileId: 1, researchEntityId: 1 },
  {
    unique: true,
    partialFilterExpression: { researchEntityId: { $exists: true } },
  },
);
studentTrackingSchema.index({ researchGroupId: 1, stage: 1 });
studentTrackingSchema.index({ researchEntityId: 1, stage: 1 });
studentTrackingSchema.index({ studentProfileId: 1, updatedAt: -1 });

export const StudentTracking = mongoose.model(
  'StudentTracking',
  studentTrackingSchema,
  'student_trackings',
);

export { studentTrackingSchema };
