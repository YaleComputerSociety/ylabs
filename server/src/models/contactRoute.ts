/**
 * Preferred contact/application routes for a research entity or pathway.
 */
import mongoose from 'mongoose';
import { recordReviewSchema } from './modelPrimitives';
import {
  contactPolicies,
  contactRouteTypes,
  contactRouteVisibilities,
} from './researchAccessTypes';

const contactRouteSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    entryPathwayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EntryPathway',
      required: false,
    },
    routeType: {
      type: String,
      enum: [...contactRouteTypes],
      required: true,
    },
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    personName: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      default: '',
    },
    email: {
      type: String,
      default: '',
    },
    url: {
      type: String,
      default: '',
    },
    label: {
      type: String,
      default: '',
    },
    name: {
      type: String,
      default: '',
    },
    priority: {
      type: Number,
      min: 0,
      default: 100,
    },
    rationale: {
      type: String,
      default: '',
    },
    visibility: {
      type: String,
      enum: [...contactRouteVisibilities],
      default: 'AUTHENTICATED',
    },
    contactPolicy: {
      type: String,
      enum: [...contactPolicies],
      default: 'UNKNOWN',
    },
    sourceEvidenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Observation',
      required: false,
    },
    sourceEvidenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Observation',
      default: [],
    },
    sourceName: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    observedAt: {
      type: Date,
      required: false,
    },
    lastMaterializedAt: {
      type: Date,
      required: false,
    },
    derivationKey: {
      type: String,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    lastObservedAt: {
      type: Date,
      required: false,
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

contactRouteSchema.index({ researchEntityId: 1 });
contactRouteSchema.index({ entryPathwayId: 1 });
contactRouteSchema.index({ routeType: 1 });
contactRouteSchema.index({ priority: 1 });
contactRouteSchema.index({ visibility: 1 });
contactRouteSchema.index({ contactPolicy: 1 });
contactRouteSchema.index({ archived: 1 });
contactRouteSchema.index({ 'review.status': 1 });
contactRouteSchema.index(
  { researchEntityId: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { derivationKey: { $type: 'string' } },
  },
);

export const ContactRoute = mongoose.model(
  'ContactRoute',
  contactRouteSchema,
  'contact_routes',
);

export { contactRouteSchema };
