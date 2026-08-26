/**
 * Mongoose schema and model for server-side student personalization.
 */
import mongoose from 'mongoose';

const studentProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    netid: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    majorDepartmentIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Department',
      default: [],
    },
    researchAreaIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'ResearchArea',
      default: [],
    },
    onboardingCompletedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

studentProfileSchema.index({ userId: 1 }, { unique: true, sparse: true });
studentProfileSchema.index({ majorDepartmentIds: 1 });
studentProfileSchema.index({ researchAreaIds: 1 });

export const StudentProfile = mongoose.model(
  'StudentProfile',
  studentProfileSchema,
  'student_profiles',
);

export { studentProfileSchema };
