/**
 * Canonical Mongoose model for research entities (`research_entities`).
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema, opennessSignalSchema } from './modelPrimitives';
import {
  mapResearchGroupKindToEntityType,
  researchEntityTypes,
  type ResearchEntityType,
} from './researchAccessTypes';
import { studentVisibilityFields } from './studentVisibility';

const researchEntitySchema = new mongoose.Schema(
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
      ref: 'ResearchEntity',
      required: false,
      default: null,
    },
    kind: {
      type: String,
      enum: ['lab', 'center', 'institute', 'program', 'initiative', 'group', 'individual', 'solo'],
      default: 'lab',
    },
    entityType: {
      type: String,
      enum: [...researchEntityTypes],
      default: function (this: { kind?: string }): ResearchEntityType {
        return mapResearchGroupKindToEntityType(this?.kind || 'lab');
      },
    },
    shortDescription: {
      type: String,
      default: '',
    },
    fullDescription: {
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
    lastGrantAtCache: {
      type: Date,
      required: false,
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
    studentDecisionExplanation: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    rosterEnrichment: {
      type: {
        state: {
          type: String,
          enum: ['current', 'partial', 'empty', 'withheld', 'stale', 'failed'],
          required: true,
        },
        complete: { type: Boolean, default: false },
        memberCount: { type: Number, min: 0, max: 40, default: 0 },
        withheldCount: { type: Number, min: 0, max: 1000, default: 0 },
        duplicateCount: { type: Number, min: 0, max: 1000, default: 0 },
        memberKeys: { type: [String], default: [] },
        sourceUrl: { type: String, default: '' },
        sourcePublishedAt: { type: Date, required: false },
        observedAt: { type: Date, required: true },
        freshnessExpiresAt: { type: Date, required: false },
        refreshOwner: { type: String, default: '' },
        refreshCadence: { type: String, default: '' },
        lastSuccessfulSnapshot: {
          type: {
            state: { type: String, enum: ['current', 'partial'], required: true },
            memberKeys: { type: [String], default: [] },
            sourceUrl: { type: String, required: true },
            sourcePublishedAt: { type: Date, required: false },
            observedAt: { type: Date, required: true },
            freshnessExpiresAt: { type: Date, required: true },
          },
          required: false,
          default: undefined,
        },
      },
      required: false,
      default: undefined,
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
    /**
     * Precomputed "best first" ranking score for the default (no-query)
     * /research browse. Higher = better. Combines completeness (description,
     * lead, source URL) with strength-weighted undergrad access signals.
     * Materializer- and backfill-maintained; mirrored to the Meilisearch
     * `researchentities` index as a sortable attribute. See
     * `services/researchEntityBrowseRank.ts`.
     */
    browseRankScore: {
      type: Number,
      default: 0,
    },
    accessAcceptanceLevel: {
      type: String,
      enum: ['verified', 'likely', 'none'],
      default: 'none',
    },
    archived: {
      type: Boolean,
      default: false,
    },
    claimedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
    ...studentVisibilityFields,
  },
  {
    timestamps: true,
  },
);

researchEntitySchema.index({ kind: 1 });
researchEntitySchema.index({ entityType: 1 });
researchEntitySchema.index({ canonicalGroupId: 1 });
researchEntitySchema.index({ school: 1 });
researchEntitySchema.index({ schools: 1 });
researchEntitySchema.index({ departments: 1 });
researchEntitySchema.index({ researchAreas: 1 });
researchEntitySchema.index({ openness: 1, acceptingUndergrads: 1 });
researchEntitySchema.index({ opennessStatusCache: 1 });
researchEntitySchema.index({ activeAtYaleCache: 1 });
researchEntitySchema.index({ archived: 1 });
researchEntitySchema.index({ lastObservedAt: 1 });
researchEntitySchema.index({ archived: 1, browseRankScore: -1 });
researchEntitySchema.index({ archived: 1, accessAcceptanceLevel: 1 });
researchEntitySchema.index({ recentGrantCount: -1 });
researchEntitySchema.index({ fundingAgencies: 1 });
researchEntitySchema.index({ offersIndependentStudy: 1 });
researchEntitySchema.index({ studentVisibilityTier: 1, archived: 1 });
researchEntitySchema.index({ studentVisibilityComputedAt: -1 });

export const ResearchEntity =
  mongoose.models.ResearchEntity ||
  mongoose.model('ResearchEntity', researchEntitySchema, 'research_entities');

export { researchEntitySchema };
