import mongoose from 'mongoose';

export const ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION = 2;
export const ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID = 'admin-access-review';

const accessReviewCountSchema = new mongoose.Schema(
  {
    entryPathways: { type: Number, required: true, min: 0, default: 0 },
    accessSignals: { type: Number, required: true, min: 0, default: 0 },
    contactRoutes: { type: Number, required: true, min: 0, default: 0 },
    postedOpportunities: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const adminAccessReviewProjectionSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    searchPrefixes: { type: [String], required: true, default: [] },
    counts: { type: accessReviewCountSchema, required: true, default: () => ({}) },
    unreviewedCounts: { type: accessReviewCountSchema, required: true, default: () => ({}) },
    totalUnreviewed: { type: Number, required: true, min: 0, default: 0 },
    hasOfficialApplication: { type: Boolean, required: true, default: false },
    sortUpdatedAt: { type: Date, required: true },
    stale: { type: Boolean, required: true, default: true },
    generation: { type: Number, required: true, min: 0, default: 0 },
    computedAt: { type: Date, required: true },
    schemaVersion: {
      type: Number,
      required: true,
      default: ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
    },
  },
  {
    collection: 'admin_access_review_projections',
    timestamps: false,
  },
);

adminAccessReviewProjectionSchema.index({ researchEntityId: 1 }, { unique: true });
adminAccessReviewProjectionSchema.index({ stale: 1, researchEntityId: 1 });
adminAccessReviewProjectionSchema.index({
  totalUnreviewed: -1,
  hasOfficialApplication: -1,
  sortUpdatedAt: -1,
  researchEntityId: 1,
});
adminAccessReviewProjectionSchema.index({
  hasOfficialApplication: -1,
  totalUnreviewed: -1,
  sortUpdatedAt: -1,
  researchEntityId: 1,
});
adminAccessReviewProjectionSchema.index({ sortUpdatedAt: -1, researchEntityId: 1 });
adminAccessReviewProjectionSchema.index({
  searchPrefixes: 1,
  totalUnreviewed: -1,
  hasOfficialApplication: -1,
  sortUpdatedAt: -1,
  researchEntityId: 1,
});
adminAccessReviewProjectionSchema.index({
  searchPrefixes: 1,
  hasOfficialApplication: -1,
  totalUnreviewed: -1,
  sortUpdatedAt: -1,
  researchEntityId: 1,
});
adminAccessReviewProjectionSchema.index({
  searchPrefixes: 1,
  sortUpdatedAt: -1,
  researchEntityId: 1,
});

const adminAccessReviewProjectionStateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    schemaVersion: {
      type: Number,
      required: true,
      default: ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
    },
    ready: { type: Boolean, required: true, default: false },
    rebuilding: { type: Boolean, required: true, default: false },
    reconciledAt: { type: Date, required: false },
  },
  {
    collection: 'admin_access_review_projection_state',
    timestamps: true,
  },
);

export const AdminAccessReviewProjection = mongoose.model(
  'AdminAccessReviewProjection',
  adminAccessReviewProjectionSchema,
);

export const AdminAccessReviewProjectionState = mongoose.model(
  'AdminAccessReviewProjectionState',
  adminAccessReviewProjectionStateSchema,
);

export { adminAccessReviewProjectionSchema, adminAccessReviewProjectionStateSchema };
