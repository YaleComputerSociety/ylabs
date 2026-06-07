/**
 * Mongoose schema and model for user accounts including faculty profile fields.
 */
import mongoose from 'mongoose';

const publicationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    doi: { type: String },
    year: { type: Number },
    venue: { type: String },
    citedByCount: { type: Number, default: 0 },
    openAccessUrl: { type: String },
    source: { type: String },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    netid: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
    },
    userType: {
      type: String,
      enum: [
        'undergraduate',
        'graduate',
        'student',
        'professor',
        'faculty',
        'staff',
        'unknown',
        'admin',
      ],
      default: 'unknown',
    },
    facultyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacultyMember',
      required: false,
    },
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: false,
    },
    userConfirmed: {
      type: Boolean,
      default: false,
    },
    fname: {
      type: String,
      required: true,
    },
    lname: {
      type: String,
      required: true,
    },
    website: {
      type: String,
    },
    bio: {
      type: String,
    },
    departments: {
      type: [String],
      default: [],
    },
    college: {
      type: String,
      required: false,
    },
    year: {
      type: String,
      required: false,
    },
    major: {
      type: [String],
      default: [],
    },
    phone: {
      type: String,
      required: false,
    },
    title: {
      type: String,
      required: false,
    },
    unit: {
      type: String,
      required: false,
    },
    upi: {
      type: String,
      required: false,
    },
    physicalLocation: {
      type: String,
      required: false,
    },
    buildingDesk: {
      type: String,
      required: false,
    },
    mailingAddress: {
      type: String,
      required: false,
    },
    primaryDepartment: {
      type: String,
      required: false,
    },
    ownListings: {
      type: [mongoose.Schema.ObjectId],
      default: [],
    },
    favListings: {
      type: [mongoose.Schema.ObjectId],
      default: [],
    },
    favFellowships: {
      type: [mongoose.Schema.ObjectId],
      default: [],
    },
    favPathways: {
      type: [mongoose.Schema.ObjectId],
      default: [],
    },
    savedPathwayPlans: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    publications: {
      type: [publicationSchema],
      default: [],
      select: false,
    },
    hIndex: {
      type: Number,
      required: false,
    },
    googleScholarId: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    googleScholarMetricsUpdatedAt: {
      type: Date,
      required: false,
    },
    orcid: {
      type: String,
      required: false,
    },
    openAlexId: {
      type: String,
      required: false,
    },
    semanticScholarId: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    openAlexWorksSyncedAt: {
      type: Date,
      required: false,
    },
    orcidWorksSyncedAt: {
      type: Date,
      required: false,
    },
    europePmcWorksSyncedAt: {
      type: Date,
      required: false,
    },
    pubmedWorksSyncedAt: {
      type: Date,
      required: false,
    },
    imageUrl: {
      type: String,
      required: false,
    },
    secondaryDepartments: {
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
    scholarCandidateProfileUrls: {
      type: [String],
      default: [],
    },
    profileVerified: {
      type: Boolean,
      default: false,
    },
    dataSources: {
      type: [String],
      default: [],
    },
    confidenceByField: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    manuallyLockedFields: {
      type: [String],
      default: [],
    },
    lastLogin: {
      type: Date,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      index: true,
    },
    loginCount: {
      type: Number,
      default: 0,
    },
    lastActive: {
      type: Date,
      index: true,
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
    dedupedIntoUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    dedupedAt: {
      type: Date,
      required: false,
    },
    dedupeReason: {
      type: String,
      required: false,
    },
    dedupedIdentityField: {
      type: String,
      required: false,
    },
    dedupedIdentityValue: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({ userType: 1, profileVerified: 1 });
userSchema.index({ primaryDepartment: 1 });
userSchema.index({ facultyMemberId: 1 }, { sparse: true });
userSchema.index({ studentProfileId: 1 }, { sparse: true });
userSchema.index({ orcid: 1 }, { sparse: true });

export const User = mongoose.model('User', userSchema);
