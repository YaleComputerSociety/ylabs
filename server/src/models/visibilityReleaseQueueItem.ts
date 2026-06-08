/**
 * Durable release queue for records held out of public student surfaces.
 */
import mongoose from 'mongoose';

export const visibilityReleaseQueueCollections = ['research', 'programs'] as const;
export const visibilityReleaseQueueStatuses = [
  'open',
  'resolved',
  'accepted_warning',
  'suppressed',
] as const;

export const visibilityRepairStages = [
  'source_description',
  'pi_identity',
  'action_evidence',
  'suppression',
  'review_exception',
] as const;

export const visibilityRepairStatuses = [
  'queued',
  'attempted',
  'repaired',
  'blocked',
  'resolved',
] as const;

export type VisibilityReleaseQueueCollection =
  (typeof visibilityReleaseQueueCollections)[number];
export type VisibilityReleaseQueueStatus = (typeof visibilityReleaseQueueStatuses)[number];
export type VisibilityRepairStage = (typeof visibilityRepairStages)[number];
export type VisibilityRepairStatus = (typeof visibilityRepairStatuses)[number];

const visibilityReleaseQueueItemSchema = new mongoose.Schema(
  {
    collection: {
      type: String,
      enum: [...visibilityReleaseQueueCollections],
      required: true,
    },
    recordId: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      default: '',
    },
    currentTier: {
      type: String,
      default: '',
    },
    computedTier: {
      type: String,
      default: '',
    },
    targetTier: {
      type: String,
      default: '',
    },
    blockerReasons: {
      type: [String],
      default: [],
    },
    evidenceSignals: {
      type: [String],
      default: [],
    },
    sourceNames: {
      type: [String],
      default: [],
    },
    nextRepairAction: {
      type: String,
      default: '',
    },
    repairStage: {
      type: String,
      enum: [...visibilityRepairStages],
      default: 'review_exception',
    },
    repairStatus: {
      type: String,
      enum: [...visibilityRepairStatuses],
      default: 'queued',
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: {
      type: Date,
      required: false,
    },
    nextAttemptAt: {
      type: Date,
      required: false,
    },
    repairSource: {
      type: String,
      default: '',
    },
    appliedPatchSummary: {
      type: [String],
      default: [],
    },
    remainingBlockers: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: [...visibilityReleaseQueueStatuses],
      default: 'open',
    },
    firstSeenAt: {
      type: Date,
      default: () => new Date(),
    },
    lastSeenAt: {
      type: Date,
      default: () => new Date(),
    },
    resolvedAt: {
      type: Date,
      required: false,
    },
    resolvedByTier: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  },
);

visibilityReleaseQueueItemSchema.index({ status: 1, collection: 1, lastSeenAt: -1 });
visibilityReleaseQueueItemSchema.index({ blockerReasons: 1, status: 1 });
visibilityReleaseQueueItemSchema.index({ sourceNames: 1, status: 1 });
visibilityReleaseQueueItemSchema.index({ repairStage: 1, repairStatus: 1, status: 1 });
visibilityReleaseQueueItemSchema.index(
  { collection: 1, recordId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'open' },
  },
);

export const VisibilityReleaseQueueItem =
  mongoose.models.VisibilityReleaseQueueItem ||
  mongoose.model(
    'VisibilityReleaseQueueItem',
    visibilityReleaseQueueItemSchema,
    'visibility_release_queue_items',
  );

export { visibilityReleaseQueueItemSchema };
