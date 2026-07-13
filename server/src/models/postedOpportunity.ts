/**
 * Specific active, rolling, closed, or archived research opportunities.
 *
 * A PostedOpportunity may wrap an existing Listing while the legacy listing
 * flow remains in place.
 */
import mongoose from 'mongoose';
import { recordReviewSchema } from './modelPrimitives';
import { compensationTypes, postedOpportunityStatuses } from './researchAccessTypes';

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
