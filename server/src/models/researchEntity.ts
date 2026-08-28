/**
 * Canonical Mongoose model for research entities (`research_entities`).
 */
import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';
import { fieldProvenanceSchema } from './modelPrimitives';
import {
  mapResearchGroupKindToEntityType,
  researchEntityTypes,
  type ResearchEntityType,
} from './researchAccessTypes';
import { studentVisibilityFields } from './studentVisibility';
import { sourceLinkHealthStatuses } from '../services/sourceLinkHealth';

export const researchEntitySchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

const sourceLinkHealthSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    healthStatus: {
      type: String,
      enum: [...sourceLinkHealthStatuses],
      default: 'UNKNOWN',
      required: true,
    },
    httpStatusCode: {
      type: Number,
      min: 100,
      max: 599,
      required: false,
    },
    checkedAt: {
      type: Date,
      required: false,
    },
  },
  { _id: false },
);

const researchEntitySchema = new mongoose.Schema<Record<string, unknown>>(
  {
    schemaVersion: canonicalSchemaVersionField(researchEntitySchemaVersion),
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
    methods: {
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
    sourceLinkHealth: {
      type: [sourceLinkHealthSchema],
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
    /**
     * True when the entity carries an undergrad-specific hosting/supervision
     * access signal (PAST_UNDERGRADS / CURRENT_UNDERGRADS /
     * FACULTY_SUPERVISES_STUDENT_PROJECTS), as opposed to a generic
     * outreach-plausibility signal. Derived from Signal by researchEntityBrowseRankService and mirrored to
     * the Meilisearch index as a filterable attribute so the "Has hosted
     * undergrads before" browse filter is truthful. See #1054.
     */
    hasUndergradHostingEvidence: {
      type: Boolean,
      default: false,
    },
    /**
     * True when the entity carries at least one allowlisted, evidence-backed
     * documented-way-in access signal (a posted/recurring opening, application
     * form, explicit contact route, undergraduate participation, or
     * faculty-supervised student projects), excluding the REACH_OUT_PLAUSIBLE
     * fallback and negative signals. Derived from Signal by researchEntityBrowseRankService and mirrored to
     * the Meilisearch index as a filterable attribute so the "documented way
     * in" browse filter is truthful. See #1519.
     */
    hasDocumentedWayIn: {
      type: Boolean,
      default: false,
    },
    /**
     * Current undergraduate-availability status ('OPEN' / 'ROLLING' /
     * 'NOT_CURRENTLY_AVAILABLE' / 'UNKNOWN'), re-derived from the
     * CURRENT_AVAILABILITY Signal by researchEntityBrowseRankService with its
     * own 60-day freshness re-check, independent of the Signal's own
     * lastMaterializedAt. Defaults to 'UNKNOWN' so a sparse/stale signal never
     * surfaces as open. Mirrored to the Meilisearch index for the "Open now" /
     * "Rolling" browse filter. See #1285.
     */
    undergraduateCurrentAvailability: {
      type: String,
      enum: ['OPEN', 'ROLLING', 'NOT_CURRENTLY_AVAILABLE', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    /**
     * Undergraduate-compensation model ('PAID_OR_STIPEND' / 'COURSE_CREDIT' /
     * 'UNKNOWN'), re-derived from the COMPENSATION Signal by
     * researchEntityBrowseRankService with its own freshness re-check,
     * independent of the Signal's own lastMaterializedAt. Defaults to 'UNKNOWN'
     * so a sparse/stale signal never surfaces as paid. Mirrored to the
     * Meilisearch index for the "Paid or stipend" / "Course credit" browse
     * filter. See #1540.
     */
    undergraduateCompensationModel: {
      type: String,
      enum: ['PAID_OR_STIPEND', 'COURSE_CREDIT', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    /**
     * Explicitly-welcomed undergraduate class years ('FIRST_YEAR' /
     * 'SOPHOMORE' / 'JUNIOR' / 'SENIOR'), re-derived from the STUDENT_LEVEL
     * Signal by researchEntityBrowseRankService with its own 365-day freshness
     * re-check, independent of the Signal's own lastMaterializedAt. Defaults to
     * [] so a sparse, stale, or conflicting signal never surfaces a class year
     * as welcome. Multi-valued because a page may name several years. Mirrored
     * to the Meilisearch index for the "Open to first-years" browse filter.
     * See #1733.
     */
    undergraduateEligibleStudentLevels: {
      type: [String],
      enum: ['FIRST_YEAR', 'SOPHOMORE', 'JUNIOR', 'SENIOR'],
      default: [],
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
researchEntitySchema.index({ activeAtYaleCache: 1 });
researchEntitySchema.index({ archived: 1 });
researchEntitySchema.index({ lastObservedAt: 1 });
researchEntitySchema.index({ archived: 1, browseRankScore: -1 });
researchEntitySchema.index({ archived: 1, hasUndergradHostingEvidence: 1 });
researchEntitySchema.index({ archived: 1, hasDocumentedWayIn: 1 });
researchEntitySchema.index({ archived: 1, undergraduateCurrentAvailability: 1 });
researchEntitySchema.index({ archived: 1, undergraduateCompensationModel: 1 });
researchEntitySchema.index({ archived: 1, undergraduateEligibleStudentLevels: 1 });
researchEntitySchema.index({ recentGrantCount: -1 });
researchEntitySchema.index({ fundingAgencies: 1 });
researchEntitySchema.index({ offersIndependentStudy: 1 });
researchEntitySchema.index({ studentVisibilityTier: 1, archived: 1 });
researchEntitySchema.index({ studentVisibilityComputedAt: -1 });

export const ResearchEntity =
  mongoose.models.ResearchEntity ||
  mongoose.model('ResearchEntity', researchEntitySchema, 'research_entities');

export { researchEntitySchema };
