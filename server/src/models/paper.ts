/**
 * Mongoose schema and model for research papers.
 *
 * Replaces the embedded User.publications array. A Paper can be authored by zero or more
 * Yale faculty (yaleAuthorIds), enabling a single paper to appear under all collaborating
 * authors without duplication.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

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
    arxivId: {
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
      ref: 'User',
      default: [],
    },
    yaleAuthorNetIds: {
      type: [String],
      default: [],
    },
    facultyMemberIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'FacultyMember',
      default: [],
    },
    researchGroupIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'ResearchGroup',
      default: [],
    },
    researchEntityIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'ResearchEntity',
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
    plainSummary: {
      type: String,
      default: '',
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
    landingPageUrl: {
      type: String,
      required: false,
    },
    pdfUrl: {
      type: String,
      required: false,
    },
    isOpenAccess: {
      type: Boolean,
      required: false,
    },
    openAccessStatus: {
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
    publicationTypes: {
      type: [String],
      default: [],
    },
    publicationStage: {
      type: String,
      enum: ['PREPRINT', 'PUBLISHED', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    preprintServer: {
      type: String,
      required: false,
    },
    postedAt: {
      type: Date,
      required: false,
    },
    versionDate: {
      type: Date,
      required: false,
    },
    externalIds: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sources: {
      type: [String],
      default: [],
    },
    sourceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Source',
      default: [],
    },
    fieldProvenance: {
      type: Map,
      of: fieldProvenanceSchema,
      default: {},
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
    crossrefHydratedAt: {
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
paperSchema.index({ facultyMemberIds: 1 });
paperSchema.index({ researchGroupIds: 1 });
paperSchema.index({ researchEntityIds: 1 });
paperSchema.index({ year: -1 });
paperSchema.index({ citationCount: -1 });
paperSchema.index({ publishedAt: -1 });
paperSchema.index({ postedAt: -1 });
paperSchema.index({ versionDate: -1 });
paperSchema.index({ fieldsOfStudy: 1 });
paperSchema.index({ publicationTypes: 1 });
paperSchema.index({ publicationStage: 1 });
paperSchema.index({ preprintServer: 1 });
paperSchema.index({ sourceIds: 1 });
paperSchema.index({ isOpenAccess: 1 });
paperSchema.index({ archived: 1 });
paperSchema.index({ lastObservedAt: 1 });
paperSchema.index({ title: 'text', abstract: 'text', tldr: 'text' });

export const Paper = mongoose.model('Paper', paperSchema, 'papers');

export { paperSchema };
