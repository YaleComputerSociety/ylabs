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
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchGroup',
      required: false,
    },
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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

listingSchema.index({ researchEntityId: 1, archived: 1 });
listingSchema.index({ researchGroupId: 1, archived: 1 });
listingSchema.index({ expiresAt: 1 });

export const Listing = mongoose.model('Listing', listingSchema);

export { listingSchema };
