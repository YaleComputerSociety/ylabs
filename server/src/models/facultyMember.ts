/**
 * Mongoose schema and model for Yale faculty academic identity.
 *
 * User remains the authentication/account model. FacultyMember is the scraper-backed
 * academic person record used by the v4 research graph.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const facultyMemberSchema = new mongoose.Schema(
  {
    netid: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
      unique: true,
      sparse: true,
    },
    slug: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
    },
    firstName: {
      type: String,
      default: '',
    },
    lastName: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    photoUrl: {
      type: String,
      default: '',
    },
    websiteUrl: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: '',
    },
    yaleStatus: {
      type: String,
      enum: ['active', 'leave', 'departed', 'unknown'],
      default: 'unknown',
    },
    activeAtYaleCache: {
      type: Boolean,
      default: true,
    },
    statusObservedAt: {
      type: Date,
      required: false,
    },
    availableFrom: {
      type: Date,
      required: false,
    },
    primaryDepartmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'departments',
      required: false,
    },
    departmentIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'departments',
      default: [],
    },
    primarySchool: {
      type: String,
      default: '',
    },
    schools: {
      type: [String],
      default: [],
    },
    researchInterests: {
      type: [String],
      default: [],
    },
    topics: {
      type: [String],
      default: [],
    },
    profileUrls: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    googleScholarId: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    semanticScholarId: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    openAlexId: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    orcidId: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    confidenceByField: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
    archived: {
      type: Boolean,
      default: false,
    },
    embedding: {
      type: [Number],
      required: false,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

facultyMemberSchema.index({ departmentIds: 1 });
facultyMemberSchema.index({ activeAtYaleCache: 1 });
facultyMemberSchema.index({ yaleStatus: 1 });
facultyMemberSchema.index({ researchInterests: 1 });
facultyMemberSchema.index({ topics: 1 });
facultyMemberSchema.index({ archived: 1 });
facultyMemberSchema.index({ lastObservedAt: 1 });
facultyMemberSchema.index({ name: 'text', bio: 'text', researchInterests: 'text', topics: 'text' });

export const FacultyMember = mongoose.model(
  'facultymembers',
  facultyMemberSchema,
  'faculty_members',
);

export { facultyMemberSchema };
