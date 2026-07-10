/**
 * Mongoose schema and model for student outreach attempts and self-reported outcomes.
 */
import mongoose from 'mongoose';

const studentOutreachSchema = new mongoose.Schema(
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
    trackingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentTracking',
      required: true,
    },
    reachedOutAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    deliveryMethod: {
      type: String,
      enum: ['mailto', 'copy', 'platform-sent', 'external-self-reported', 'official-route'],
      default: 'mailto',
    },
    emailGeneratedByPlatform: {
      type: Boolean,
      default: false,
    },
    templateVersion: {
      type: String,
      default: '',
    },
    outcome: {
      type: String,
      enum: [
        'no-response',
        'responded-not-interested',
        'responded-interested',
        'joined-lab',
        'unknown',
      ],
      default: 'unknown',
    },
    outcomeReportedAt: {
      type: Date,
      required: false,
    },
    outcomePromptedAt: {
      type: Date,
      required: false,
    },
    studentConsentedToAggregateUse: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

studentOutreachSchema.index({
  studentProfileId: 1,
  researchGroupId: 1,
  reachedOutAt: -1,
});
studentOutreachSchema.index({
  studentProfileId: 1,
  researchEntityId: 1,
  reachedOutAt: -1,
});
studentOutreachSchema.index({ researchGroupId: 1, outcome: 1, reachedOutAt: -1 });
studentOutreachSchema.index({ researchEntityId: 1, outcome: 1, reachedOutAt: -1 });
studentOutreachSchema.index({ trackingId: 1 });

export const StudentOutreach = mongoose.model(
  'StudentOutreach',
  studentOutreachSchema,
  'student_outreaches',
);

export { studentOutreachSchema };
