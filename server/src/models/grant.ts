/**
 * Mongoose schema and model for grant funding records.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const grantSchema = new mongoose.Schema(
  {
    externalId: {
      type: String,
      required: true,
    },
    agency: {
      type: String,
      enum: ['NIH', 'NSF', 'DOD', 'other'],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    abstract: {
      type: String,
      default: '',
    },
    plainSummary: {
      type: String,
      default: '',
    },
    amount: {
      type: Number,
      required: false,
    },
    startDate: {
      type: Date,
      required: false,
    },
    endDate: {
      type: Date,
      required: false,
    },
    piFacultyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'facultymembers',
      required: false,
    },
    coPiFacultyMemberIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'facultymembers',
      default: [],
    },
    researchGroupIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'researchgroups',
      default: [],
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    fiscalYear: {
      type: Number,
      required: false,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'pending', 'terminated', 'unknown'],
      default: 'unknown',
    },
    keywords: {
      type: [String],
      default: [],
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

grantSchema.index({ agency: 1, externalId: 1 }, { unique: true });
grantSchema.index({ researchGroupIds: 1 });
grantSchema.index({ piFacultyMemberId: 1 });
grantSchema.index({ coPiFacultyMemberIds: 1 });
grantSchema.index({ fiscalYear: -1 });
grantSchema.index({ status: 1 });
grantSchema.index({ endDate: 1 });
grantSchema.index({ archived: 1 });
grantSchema.index({ lastObservedAt: 1 });
grantSchema.index({ title: 'text', abstract: 'text', plainSummary: 'text', keywords: 'text' });

export const Grant = mongoose.model('grants', grantSchema);

export { grantSchema };
