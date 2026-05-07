/**
 * Mongoose schema and model for research lab listing records.
 */
import mongoose from 'mongoose';

const listingSchema = new mongoose.Schema(
  {
    ownerId: {
      type: String,
      required: true,
    },
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'researchgroups',
      required: false,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
    },
    ownerFirstName: {
      type: String,
      required: true,
    },
    ownerLastName: {
      type: String,
      required: true,
    },
    ownerEmail: {
      type: String,
      required: true,
    },
    ownerTitle: {
      type: String,
      required: false,
    },
    ownerPrimaryDepartment: {
      type: String,
      required: false,
    },
    professorIds: {
      type: [String],
      default: [],
    },
    professorNames: {
      type: [String],
      default: [],
    },
    departments: {
      type: [String],
      default: [],
    },
    emails: {
      type: [String],
      default: [],
    },
    title: {
      type: String,
      required: true,
    },
    hiringStatus: {
      type: Number,
      default: 0,
    },
    websites: {
      type: [String],
      required: false,
    },
    description: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['ra', 'thesis', 'independent-study', 'volunteer'],
      required: false,
    },
    commitment: {
      type: String,
      default: '',
    },
    compensationType: {
      type: String,
      enum: ['paid', 'volunteer', 'course-credit', 'fellowship-eligible'],
      required: false,
    },
    applicantDescription: {
      type: String,
      required: false,
      default: '',
    },
    researchAreas: {
      type: [String],
      required: false,
    },
    keywords: {
      type: [String],
      required: false,
    },
    established: {
      type: Number,
      required: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    favorites: {
      type: Number,
      default: 0,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    confirmed: {
      type: Boolean,
      default: true,
    },
    audited: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: false,
    },
    archivedAt: {
      type: Date,
      required: false,
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

listingSchema.index({ researchGroupId: 1, archived: 1 });
listingSchema.index({ expiresAt: 1 });

export const Listing = mongoose.model('listings', listingSchema);

export { listingSchema };
