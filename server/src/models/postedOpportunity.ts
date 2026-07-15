/**
 * Specific active, rolling, closed, or archived research opportunities.
 *
 * A PostedOpportunity may wrap an existing Listing while the legacy listing
 * flow remains in place.
 */
import mongoose from 'mongoose';
import { recordReviewSchema } from './modelPrimitives';
import { compensationTypes, postedOpportunityStatuses } from './researchAccessTypes';

const facultyOpportunityAuditSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['DRAFT_CREATED', 'DRAFT_UPDATED', 'SUBMITTED', 'CLOSED', 'ARCHIVED'],
      required: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    revision: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const postedOpportunitySchema = new mongoose.Schema(
  {
    entryPathwayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EntryPathway',
      required: true,
    },
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: false,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 5000,
    },
    term: {
      type: String,
      default: '',
    },
    deadline: {
      type: Date,
      required: false,
    },
    applicationUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: [...postedOpportunityStatuses],
      default: 'OPEN',
    },
    hoursPerWeek: {
      type: Number,
      required: false,
    },
    payRate: {
      type: String,
      default: '',
    },
    compensationType: {
      type: String,
      enum: [...compensationTypes],
      default: 'UNKNOWN',
    },
    eligibility: {
      type: String,
      default: '',
    },
    sourceEvidenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Observation',
      default: [],
    },
    sourceUrls: {
      type: [String],
      default: [],
    },
    derivationKey: {
      type: String,
      required: false,
    },
    origin: {
      type: String,
      enum: ['FACULTY_SUBMITTED', 'LISTING_BRIDGED', 'SCRAPER_DERIVED'],
      required: false,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    ownerMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchGroupMember',
      required: false,
    },
    idempotencyKey: {
      type: String,
      required: false,
      maxlength: 128,
    },
    submissionStatus: {
      type: String,
      enum: ['DRAFT', 'PENDING_REVIEW', 'REVIEWED'],
      required: false,
    },
    submittedAt: {
      type: Date,
      required: false,
    },
    closedAt: {
      type: Date,
      required: false,
    },
    archivedAt: {
      type: Date,
      required: false,
    },
    revision: {
      type: Number,
      min: 0,
      default: 0,
    },
    auditHistory: {
      type: [facultyOpportunityAuditSchema],
      default: [],
    },
    archived: {
      type: Boolean,
      default: false,
    },
    review: {
      type: recordReviewSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  },
);

postedOpportunitySchema.index({ entryPathwayId: 1 });
postedOpportunitySchema.index({ researchEntityId: 1 });
postedOpportunitySchema.index({ listingId: 1 });
postedOpportunitySchema.index({ status: 1 });
postedOpportunitySchema.index({ deadline: 1 });
postedOpportunitySchema.index({ term: 1 });
postedOpportunitySchema.index({ applicationUrl: 1 });
postedOpportunitySchema.index({ archived: 1 });
postedOpportunitySchema.index({ createdByUserId: 1, updatedAt: -1 });
postedOpportunitySchema.index(
  { createdByUserId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      createdByUserId: { $type: 'objectId' },
      idempotencyKey: { $type: 'string' },
    },
  },
);
postedOpportunitySchema.index({ 'review.status': 1 });
postedOpportunitySchema.index({ researchEntityId: 1, 'review.status': 1, 'review.reviewedAt': -1 });
postedOpportunitySchema.index(
  { entryPathwayId: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { derivationKey: { $type: 'string' } },
  },
);

export const PostedOpportunity = mongoose.model(
  'PostedOpportunity',
  postedOpportunitySchema,
  'posted_opportunities',
);

export { postedOpportunitySchema };
