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

export const Listing = mongoose.model('listings', listingSchema);

export { listingSchema };
