/**
 * Mongoose schema and model for research groups (labs, centers, institutes, programs, etc.).
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema, opennessSignalSchema } from './modelPrimitives';

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
    displayName: {
      type: String,
      required: false,
    },
    canonicalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'researchgroups',
      required: false,
      default: null,
    },
    kind: {
      type: String,
      enum: [
        'lab',
        'center',
        'institute',
        'program',
        'initiative',
        'group',
        'individual',
        'solo',
      ],
      default: 'lab',
    },
    shortDescription: {
      type: String,
      default: '',
    },
    fullDescription: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      default: '',
    },
    website: {
      type: String,
      default: '',
    },
    websiteUrl: {
      type: String,
      default: '',
    },
    primaryDepartmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'departments',
      required: false,
    },
    departmentIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'departments',
      default: [],
    },
    researchAreaIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'researchareas',
      default: [],
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
    schools: {
      type: [String],
      default: [],
    },
    yaleStatusCache: {
      type: String,
      enum: ['active', 'leave', 'departed', 'unknown'],
      default: 'unknown',
    },
    activeAtYaleCache: {
      type: Boolean,
      default: true,
    },
    availableFrom: {
      type: Date,
      required: false,
    },
    opennessSignals: {
      type: [opennessSignalSchema],
      default: [],
    },
    opennessStatusCache: {
      type: String,
      enum: ['verified-accepting', 'likely-accepting', 'unknown', 'not-available'],
      default: 'unknown',
    },
    opennessExplanationCache: {
      type: [String],
      default: [],
    },
    opennessComputedAt: {
      type: Date,
      required: false,
    },
    opennessLastSignalAt: {
      type: Date,
      required: false,
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
    lastPaperAtCache: {
      type: Date,
      required: false,
    },
    lastGrantAtCache: {
      type: Date,
      required: false,
    },
    activePaperCount2yCache: {
      type: Number,
      default: 0,
    },
    activityComputedAt: {
      type: Date,
      required: false,
    },
    lastViewAtCache: {
      type: Date,
      required: false,
    },
    lastSaveAtCache: {
      type: Date,
      required: false,
    },
    lastOutreachAtCache: {
      type: Date,
      required: false,
    },
    lastInquiryAtCache: {
      type: Date,
      required: false,
    },
    totalInquiriesCache: {
      type: Number,
      default: 0,
    },
    lastFacultyNotificationAt: {
      type: Date,
      required: false,
    },
    featuredPaperIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'papers',
      default: [],
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
    fieldProvenance: {
      type: Map,
      of: fieldProvenanceSchema,
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
    claimedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
    },
    claimedByFaculty: {
      type: Boolean,
      default: false,
    },
    claimedAt: {
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

researchGroupSchema.index({ kind: 1 });
researchGroupSchema.index({ canonicalGroupId: 1 });
researchGroupSchema.index({ school: 1 });
researchGroupSchema.index({ schools: 1 });
researchGroupSchema.index({ departments: 1 });
researchGroupSchema.index({ departmentIds: 1 });
researchGroupSchema.index({ researchAreas: 1 });
researchGroupSchema.index({ researchAreaIds: 1 });
researchGroupSchema.index({ openness: 1, acceptingUndergrads: 1 });
researchGroupSchema.index({ opennessStatusCache: 1 });
researchGroupSchema.index({ activeAtYaleCache: 1 });
researchGroupSchema.index({ archived: 1 });
researchGroupSchema.index({ lastObservedAt: 1 });
researchGroupSchema.index({ recentGrantCount: -1 });
researchGroupSchema.index({ recentPaperCount: -1 });
researchGroupSchema.index({ fundingAgencies: 1 });
researchGroupSchema.index({ offersIndependentStudy: 1 });

export const ResearchGroup = mongoose.model(
  'researchgroups',
  researchGroupSchema,
  'research_groups',
);

export { researchGroupSchema };
