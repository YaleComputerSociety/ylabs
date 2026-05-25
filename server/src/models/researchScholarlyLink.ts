import mongoose from 'mongoose';

export const scholarlyLinkDestinationKinds = [
  'DOI',
  'PUBLISHER',
  'PUBMED',
  'PMC',
  'ARXIV',
  'ORCID',
  'OPENALEX',
  'OFFICIAL_PROFILE',
  'OTHER',
] as const;

export const scholarlyLinkDiscoverySources = [
  'OPENALEX',
  'ORCID',
  'OFFICIAL_PROFILE',
  'MANUAL',
  'LEGACY',
] as const;

const externalIdsSchema = new mongoose.Schema(
  {
    doi: { type: String, required: false },
    openAlexId: { type: String, required: false },
    arxivId: { type: String, required: false },
    pmid: { type: String, required: false },
    pmcid: { type: String, required: false },
  },
  { _id: false },
);

const researchScholarlyLinkSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    sourcePaperId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    destinationKind: {
      type: String,
      enum: scholarlyLinkDestinationKinds,
      required: true,
    },
    displaySource: {
      type: String,
      required: true,
      trim: true,
    },
    freeFullTextUrl: {
      type: String,
      default: '',
      trim: true,
    },
    freeFullTextLabel: {
      type: String,
      default: '',
      trim: true,
    },
    year: {
      type: Number,
      required: false,
    },
    venue: {
      type: String,
      default: '',
      trim: true,
    },
    discoveredVia: {
      type: String,
      enum: scholarlyLinkDiscoverySources,
      required: true,
    },
    externalIds: {
      type: externalIdsSchema,
      default: {},
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.7,
    },
    observedAt: {
      type: Date,
      default: () => new Date(),
    },
    sourceUrl: {
      type: String,
      default: '',
      trim: true,
    },
    crossrefHydratedAt: {
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

researchScholarlyLinkSchema.index({ researchEntityId: 1, archived: 1, year: -1 });
researchScholarlyLinkSchema.index({ userId: 1, archived: 1, year: -1 });
researchScholarlyLinkSchema.index({ destinationKind: 1 });
researchScholarlyLinkSchema.index({ discoveredVia: 1 });
researchScholarlyLinkSchema.index({ observedAt: -1 });
researchScholarlyLinkSchema.index({ crossrefHydratedAt: 1 });
researchScholarlyLinkSchema.index(
  { researchEntityId: 1, url: 1 },
  {
    unique: true,
    partialFilterExpression: {
      researchEntityId: { $exists: true },
      archived: false,
    },
  },
);
researchScholarlyLinkSchema.index(
  { userId: 1, url: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $exists: true },
      archived: false,
    },
  },
);

export const ResearchScholarlyLink = mongoose.model(
  'ResearchScholarlyLink',
  researchScholarlyLinkSchema,
  'research_scholarly_links',
);

export { researchScholarlyLinkSchema };
