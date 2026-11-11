/**
 * A listed person's private request to be removed from the directory (#4160).
 *
 * A row holds only the requester's CAS netid, the Researcher it matched, a status, and when
 * and by whom it was decided. There is no reason or note field, so nothing a person types
 * can be stored here. `strict: 'throw'` refuses any other path.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: a request made
 * on Production must survive a promotion, and a Development refresh must not clear one.
 */
import mongoose from 'mongoose';

export const DIRECTORY_REMOVAL_REQUEST_COLLECTION = 'directory_removal_requests';

export const directoryRemovalRequestStatuses = ['pending', 'accepted', 'declined'] as const;
export type DirectoryRemovalRequestStatus = (typeof directoryRemovalRequestStatuses)[number];

export const directoryRemovalRequestDecisions = ['accepted', 'declined'] as const;
export type DirectoryRemovalRequestDecision = (typeof directoryRemovalRequestDecisions)[number];

const directoryRemovalRequestSchema = new mongoose.Schema(
  {
    requesterNetid: { type: String, required: true, trim: true, lowercase: true, maxlength: 64 },
    researcherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Researcher', required: true },
    status: {
      type: String,
      enum: [...directoryRemovalRequestStatuses],
      required: true,
      default: 'pending',
    },
    decidedAt: { type: Date, required: false },
    decidedBy: { type: String, required: false, trim: true, lowercase: true, maxlength: 64 },
  },
  {
    strict: 'throw',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

directoryRemovalRequestSchema.index({ requesterNetid: 1, createdAt: -1 });
directoryRemovalRequestSchema.index({ status: 1, createdAt: -1 });
directoryRemovalRequestSchema.index(
  { requesterNetid: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'one_pending_request_per_netid',
  },
);

export const DirectoryRemovalRequest = mongoose.model(
  'DirectoryRemovalRequest',
  directoryRemovalRequestSchema,
  DIRECTORY_REMOVAL_REQUEST_COLLECTION,
);
