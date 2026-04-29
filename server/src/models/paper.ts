/**
 * Mongoose schema and model for research papers.
 *
 * Replaces the embedded User.publications array. A Paper can be authored by zero or more
 * Yale faculty (yaleAuthorIds), enabling a single paper to appear under all collaborating
 * authors without duplication.
 */
import mongoose from 'mongoose';

const paperSchema = new mongoose.Schema(
  {
    openAlexId: {
      type: String,
      required: false,
      sparse: true,
      unique: true,
    },
    semanticScholarId: {
      type: String,
      required: false,
      sparse: true,
      unique: true,
    },
    doi: {
      type: String,
      required: false,
      sparse: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    authors: {
      type: [String],
      default: [],
    },
    yaleAuthorIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'users',
      default: [],
    },
    yaleAuthorNetIds: {
      type: [String],
      default: [],
    },
    year: {
      type: Number,
      required: false,
    },
    venue: {
      type: String,
      required: false,
    },
    abstract: {
      type: String,
      required: false,
    },
    tldr: {
      type: String,
      required: false,
    },
    url: {
      type: String,
      required: false,
    },
    openAccessUrl: {
      type: String,
      required: false,
    },
    citationCount: {
      type: Number,
      default: 0,
    },
    publishedAt: {
      type: Date,
      required: false,
    },
    fieldsOfStudy: {
      type: [String],
      default: [],
    },
    sources: {
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

paperSchema.index({ yaleAuthorIds: 1 });
paperSchema.index({ yaleAuthorNetIds: 1 });
paperSchema.index({ year: -1 });
paperSchema.index({ citationCount: -1 });
paperSchema.index({ publishedAt: -1 });
paperSchema.index({ fieldsOfStudy: 1 });
paperSchema.index({ archived: 1 });
paperSchema.index({ lastObservedAt: 1 });
paperSchema.index({ title: 'text', abstract: 'text', tldr: 'text' });

export const Paper = mongoose.model('papers', paperSchema);

export { paperSchema };
