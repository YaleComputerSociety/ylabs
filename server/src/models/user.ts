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
    cited_by_count: { type: Number, default: 0 },
    open_access_url: { type: String },
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
      enum: ['undergraduate', 'graduate', 'professor', 'faculty', 'unknown', 'admin'],
      default: 'unknown',
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
    physical_location: {
      type: String,
      required: false,
    },
    building_desk: {
      type: String,
      required: false,
    },
    mailing_address: {
      type: String,
      required: false,
    },
    primary_department: {
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
    publications: {
      type: [publicationSchema],
      default: [],
      select: false,
    },
    h_index: {
      type: Number,
      required: false,
    },
    orcid: {
      type: String,
      required: false,
    },
    openalex_id: {
      type: String,
      required: false,
    },
    image_url: {
      type: String,
      required: false,
    },
    secondary_departments: {
      type: [String],
      default: [],
    },
    research_interests: {
      type: [String],
      default: [],
    },
    topics: {
      type: [String],
      default: [],
    },
    profile_urls: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    profileVerified: {
      type: Boolean,
      default: false,
    },
    data_sources: {
      type: [String],
      default: [],
    },
    lastLogin: {
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
  },
  {
    timestamps: true,
  },
);

userSchema.index({ userType: 1, profileVerified: 1 });
userSchema.index({ primary_department: 1 });

export const User = mongoose.model('users', userSchema);
