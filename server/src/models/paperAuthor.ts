/**
 * Mongoose schema and model for Paper ↔ FacultyMember authorship.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const paperAuthorSchema = new mongoose.Schema(
  {
    paperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paper',
      required: true,
    },
    facultyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacultyMember',
      required: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    displayName: {
      type: String,
      required: true,
    },
    authorPosition: {
      type: Number,
      required: false,
    },
    isCorresponding: {
      type: Boolean,
      default: false,
    },
    affiliationText: {
      type: String,
      default: '',
    },
    externalAuthorIds: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    fieldProvenance: {
      type: Map,
      of: fieldProvenanceSchema,
      default: {},
    },
    lastObservedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

paperAuthorSchema.index({ paperId: 1 });
paperAuthorSchema.index({ facultyMemberId: 1 });
paperAuthorSchema.index({ userId: 1 });
paperAuthorSchema.index({ paperId: 1, facultyMemberId: 1 });
paperAuthorSchema.index({ lastObservedAt: 1 });

export const PaperAuthor = mongoose.model('PaperAuthor', paperAuthorSchema, 'paper_authors');

export { paperAuthorSchema };
