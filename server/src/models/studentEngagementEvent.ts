/**
 * Append-only student engagement events for research groups.
 */
import mongoose from 'mongoose';

const studentEngagementEventSchema = new mongoose.Schema(
  {
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: false,
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
    eventType: {
      type: String,
      enum: ['view', 'save', 'unsave', 'outreach-click'],
      required: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

studentEngagementEventSchema.index({ researchGroupId: 1, eventType: 1, occurredAt: -1 });
studentEngagementEventSchema.index({ researchEntityId: 1, eventType: 1, occurredAt: -1 });
studentEngagementEventSchema.index({ studentProfileId: 1, occurredAt: -1 });
studentEngagementEventSchema.index({ occurredAt: -1 });

export const StudentEngagementEvent = mongoose.model(
  'StudentEngagementEvent',
  studentEngagementEventSchema,
  'student_engagement_events',
);

export { studentEngagementEventSchema };
