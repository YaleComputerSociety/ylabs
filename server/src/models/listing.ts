/**
 * Mongoose schema and model for research lab listing records.
 */
import mongoose from 'mongoose';

const evidenceSourceSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: false,
    },
    url: {
      type: String,
      required: false,
    },
    sourceType: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
    },
    lastCheckedAt: {
      type: Date,
      required: false,
    },
  },
  { _id: false },
);

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
    evidence: {
      status: {
        type: String,
        required: false,
      },
      summary: {
        type: String,
        required: false,
      },
      confidence: {
        type: Number,
        required: false,
      },
      generatedAt: {
        type: Date,
        required: false,
      },
      lastVerifiedAt: {
        type: Date,
        required: false,
      },
      sources: {
        type: [evidenceSourceSchema],
        default: [],
      },
      internalNotes: {
        type: String,
        required: false,
        select: false,
      },
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
