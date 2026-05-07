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
      ref: 'studentprofiles',
      required: true,
    },
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'researchgroups',
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
studentTrackingSchema.index({ researchGroupId: 1, stage: 1 });
studentTrackingSchema.index({ studentProfileId: 1, updatedAt: -1 });

export const StudentTracking = mongoose.model(
  'studenttrackings',
  studentTrackingSchema,
  'student_trackings',
);

export { studentTrackingSchema };
