/**
 * Canonical Mongoose model for research entities (`research_entities`).
 */
import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';
import { fieldLockProvenanceSchema, fieldProvenanceSchema } from './modelPrimitives';
import {
  mapResearchGroupKindToEntityType,
  researchEntityTypes,
  researchGroupKinds,
  type ResearchEntityType,
} from './researchAccessTypes';
import { studentVisibilityFields } from './studentVisibility';
import { sourceLinkHealthStatuses } from '../services/sourceLinkHealth';
import {
  labSiteLeadMatchReasons,
  labSiteLeadVerdicts,
  labSiteVerificationStates,
} from '../scrapers/utils/labSiteLeadVerification';

export const researchEntitySchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

/**
 * One lead's verdict against the research home's own website. Holds a person
 * reference and never a name, so the stored row cannot leak a person-bearing
 * identifier next to a defect judgement.
 */
const leadVerificationJudgementSchema = new mongoose.Schema(
  {
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Researcher',
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    verdict: {
      type: String,
      enum: [...labSiteLeadVerdicts],
      required: true,
    },
    matchedBy: {
      type: String,
      enum: [...labSiteLeadMatchReasons],
      default: 'NONE',
      required: true,
    },
    evidenceUrl: {
      type: String,
      default: '',
    },
  },
  { _id: false },
);

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
    /**
     * The host resolves only into private address space, so a student off the
     * Yale network cannot reach it whatever `healthStatus` says. A separate axis
     * on purpose: it is a fact about addressing that no page fetch establishes
     * and no freshness horizon expires (#2556).
     */
    privateAddressHost: {
      type: Boolean,
      required: false,
    },
    checkedAt: {
      type: Date,
      required: false,
    },
    /**
     * When a probe last ran for this URL, as opposed to when it last produced a
     * verdict. They differ when an inconclusive probe preserved a decisive stored
     * verdict: the assertion keeps its original `checkedAt` so the freshness
     * horizon can still age it out, while this records that we did try (#2762).
     */
    lastAttemptedAt: {
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
      enum: [...researchGroupKinds],
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
    // Org strings a source listed beside the appointment that are not canonical
    // departments: centers, hospital systems, graduate programs, societies. Search
    // text only, never a facet, so the department facet stays an org-chart
    // assertion while these stay findable (#2194).
    orgAffiliationLabels: {
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
    yaleStatusReasonCache: {
      type: String,
      enum: ['deceased', 'departed', ''],
      default: '',
    },
    lastSeenInCompleteRosterAt: {
      type: Date,
      required: false,
    },
    absentFromRosterSinceRunId: {
      type: String,
      default: '',
    },
    absentFromIndexSinceRunId: {
      type: String,
      default: '',
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
    leadVerification: {
      type: {
        state: {
          type: String,
          enum: [...labSiteVerificationStates],
          required: true,
        },
        checkedUrl: { type: String, default: '' },
        httpStatusCode: { type: Number, min: 100, max: 599, required: false },
        pagesRead: { type: Number, min: 0, default: 0 },
        confirmedCount: { type: Number, min: 0, default: 0 },
        contradictedCount: { type: Number, min: 0, default: 0 },
        unstatedCount: { type: Number, min: 0, default: 0 },
        leads: {
          type: [leadVerificationJudgementSchema],
          default: [],
        },
        observedAt: { type: Date, required: true },
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
    /**
     * Why each `manuallyLockedFields` entry was locked, keyed by field name. A
     * field locked without an entry here reads as `unknown`, which is the
     * conservative reading: a lock is never revisited on the strength of a
     * missing record. See `utils/researchEntityFieldLocks.ts` (#2612).
     */
    fieldLockProvenance: {
      type: Map,
      of: fieldLockProvenanceSchema,
      default: {},
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
researchEntitySchema.index({ recentGrantCount: -1 });
researchEntitySchema.index({ fundingAgencies: 1 });
researchEntitySchema.index({ offersIndependentStudy: 1 });
researchEntitySchema.index({ studentVisibilityTier: 1, archived: 1 });
researchEntitySchema.index({ studentVisibilityComputedAt: -1 });

export const ResearchEntity =
  mongoose.models.ResearchEntity ||
  mongoose.model('ResearchEntity', researchEntitySchema, 'research_entities');

export { researchEntitySchema };
