/**
 * Canonical student-facing research activity link.
 *
 * These records are the launch-facing replacement for relying on legacy
 * papers/paper_authors materialization for profile and research-home activity.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const researchScholarlyLinkSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      default: '',
    },
    destinationKind: {
      type: String,
      default: 'OTHER',
    },
    displaySource: {
      type: String,
      default: 'Research activity',
    },
    freeFullTextUrl: {
      type: String,
      default: '',
    },
    freeFullTextLabel: {
      type: String,
      default: '',
    },
    discoveredVia: {
      type: String,
      default: '',
    },
    year: {
      type: Number,
      required: false,
    },
    venue: {
      type: String,
      default: '',
    },
    citationCount: {
      type: Number,
      required: false,
    },
    publishedAt: {
      type: Date,
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
    publicationStage: {
      type: String,
      default: 'UNKNOWN',
    },
    preprintServer: {
      type: String,
      default: '',
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    externalIds: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sources: {
      type: [String],
      default: [],
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
    archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

researchScholarlyLinkSchema.index({ researchEntityId: 1, archived: 1 });
researchScholarlyLinkSchema.index({ userId: 1, archived: 1 });
researchScholarlyLinkSchema.index({ publishedAt: -1 });
researchScholarlyLinkSchema.index({ postedAt: -1 });
researchScholarlyLinkSchema.index({ year: -1 });
researchScholarlyLinkSchema.index({ title: 'text', venue: 'text' });

export const ResearchScholarlyLink = mongoose.model(
  'ResearchScholarlyLink',
  researchScholarlyLinkSchema,
  'research_scholarly_links',
);

export { researchScholarlyLinkSchema };
