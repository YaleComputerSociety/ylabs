import mongoose from 'mongoose';

const studentApplicationSchema = new mongoose.Schema(
  {
    legacyApplicationId: {
      type: String,
      required: true,
      unique: true,
    },
    listingId: {
      type: String,
      default: '',
    },
    listingObjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: false,
    },
    postedOpportunityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PostedOpportunity',
      required: false,
    },
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    studentId: {
      type: String,
      default: '',
    },
    studentUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: false,
    },
    studentName: {
      type: String,
      default: '',
    },
    studentEmail: {
      type: String,
      default: '',
    },
    studentNetId: {
      type: String,
      default: '',
    },
    resumeUrl: {
      type: String,
      default: '',
    },
    coverLetter: {
      type: String,
      default: '',
    },
    customQuestions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    status: {
      type: String,
      default: '',
    },
    appliedAt: {
      type: Date,
      required: false,
    },
    professorNotes: {
      type: String,
      default: '',
    },
    legacyPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      select: false,
    },
    migratedAt: {
      type: Date,
      default: () => new Date(),
    },
    legacySourceCollection: {
      type: String,
      default: 'applications',
    },
  },
  {
    timestamps: true,
  },
);

studentApplicationSchema.index({ listingObjectId: 1 });
studentApplicationSchema.index({ postedOpportunityId: 1 });
studentApplicationSchema.index({ researchEntityId: 1 });
studentApplicationSchema.index({ studentUserId: 1 });
studentApplicationSchema.index({ studentProfileId: 1 });
studentApplicationSchema.index({ studentNetId: 1 });
studentApplicationSchema.index({ status: 1 });
studentApplicationSchema.index({ appliedAt: -1 });

export const StudentApplication = mongoose.model(
  'StudentApplication',
  studentApplicationSchema,
  'student_applications',
);

export { studentApplicationSchema };
