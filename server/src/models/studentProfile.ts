/**
 * Mongoose schema and model for server-side student personalization.
 */
import mongoose from 'mongoose';

const studentProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    netid: {
      type: String,
      required: true,
      unique: true,
    },
    graduationYear: {
      type: Number,
      required: false,
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
    lookingFor: {
      type: String,
      enum: ['exploring', 'ra-position', 'thesis-advisor', 'independent-study'],
      default: 'exploring',
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

studentProfileSchema.index({ majorDepartmentIds: 1 });
studentProfileSchema.index({ researchAreaIds: 1 });
studentProfileSchema.index({ lookingFor: 1 });

export const StudentProfile = mongoose.model(
  'StudentProfile',
  studentProfileSchema,
  'student_profiles',
);

export { studentProfileSchema };
