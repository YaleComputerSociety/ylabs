/**
 * Mongoose schema and model for research groups (labs, centers, institutes, programs, etc.).
 */
import mongoose from 'mongoose';

const researchGroupSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    kind: {
      type: String,
      enum: ['lab', 'center', 'institute', 'program', 'initiative', 'group', 'individual'],
      default: 'lab',
    },
    description: {
      type: String,
      default: '',
    },
    websiteUrl: {
      type: String,
      default: '',
    },
    location: {
      type: String,
      default: '',
    },
    departments: {
      type: [String],
      default: [],
    },
    researchAreas: {
      type: [String],
      default: [],
    },
    school: {
      type: String,
      default: '',
    },
    openness: {
      type: String,
      enum: ['open', 'inquire', 'closed', 'unknown'],
      default: 'open',
    },
    acceptingUndergrads: {
      type: Boolean,
      required: false,
    },
    currentUndergradCount: {
      type: Number,
      required: false,
    },
    undergradEvidenceQuote: {
      type: String,
      default: '',
    },
    pastUndergradAdvisees: {
      type: [
        {
          year: { type: Number },
          programName: { type: String },
          count: { type: Number, default: 1 },
        },
      ],
      default: [],
    },
    offersIndependentStudy: {
      type: Boolean,
      default: false,
    },
    independentStudyCourses: {
      type: [
        {
          code: { type: String },
          title: { type: String },
        },
      ],
      default: [],
    },
    recentGrants: {
      type: [
        {
          id: { type: String },
          agency: { type: String },
          title: { type: String },
          abstract: { type: String, default: '' },
          startDate: { type: Date },
          endDate: { type: Date },
          dollarAmount: { type: Number },
          url: { type: String },
          role: { type: String, enum: ['pi', 'copi'], default: 'pi' },
        },
      ],
      default: [],
    },
    recentGrantCount: {
      type: Number,
      default: 0,
    },
    fundingAgencies: {
      type: [String],
      default: [],
    },
    recentPaperCount: {
      type: Number,
      default: 0,
    },
    typicalUndergradRoles: {
      type: [String],
      default: [],
    },
    prerequisiteCourses: {
      type: [String],
      default: [],
    },
    creditOptions: {
      type: [String],
      default: [],
    },
    fundingPrograms: {
      type: [String],
      default: [],
    },
    timeCommitmentHoursPerWeek: {
      type: {
        min: { type: Number },
        max: { type: Number },
      },
      default: undefined,
    },
    contactEmail: {
      type: String,
      default: '',
    },
    contactName: {
      type: String,
      default: '',
    },
    contactRole: {
      type: String,
      default: '',
    },
    sourceUrls: {
      type: [String],
      default: [],
    },
    confidenceByField: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    /**
     * Denormalized mirror of `confidenceByField['acceptingUndergrads']` so
     * Meilisearch can filter on it (Meili can't index nested mixed objects).
     * The materializer is the only writer — see entityMaterializer.ts.
     */
    acceptanceConfidence: {
      type: Number,
      default: 0,
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

researchGroupSchema.index({ kind: 1 });
researchGroupSchema.index({ school: 1 });
researchGroupSchema.index({ departments: 1 });
researchGroupSchema.index({ researchAreas: 1 });
researchGroupSchema.index({ openness: 1, acceptingUndergrads: 1 });
researchGroupSchema.index({ archived: 1 });
researchGroupSchema.index({ lastObservedAt: 1 });
researchGroupSchema.index({ recentGrantCount: -1 });
researchGroupSchema.index({ recentPaperCount: -1 });
researchGroupSchema.index({ fundingAgencies: 1 });
researchGroupSchema.index({ offersIndependentStudy: 1 });

export const ResearchGroup = mongoose.model('researchgroups', researchGroupSchema);

export { researchGroupSchema };
