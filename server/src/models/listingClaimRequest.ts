/**
 * Mongoose schema and model for untrusted listing claim/correction requests.
 */
import mongoose from 'mongoose';

export const ListingClaimRequestType = ['claim', 'correction'] as const;
export const ListingClaimRequestStatus = ['pending', 'approved', 'rejected'] as const;

const requesterSnapshotSchema = new mongoose.Schema(
  {
    netId: { type: String, required: true },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    userType: { type: String, default: 'unknown' },
    userConfirmed: { type: Boolean, default: false },
    profileVerified: { type: Boolean, default: false },
  },
  { _id: false },
);

const listingSnapshotSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    ownerId: { type: String, default: '' },
    ownerEmail: { type: String, default: '' },
    ownerName: { type: String, default: '' },
  },
  { _id: false },
);

const listingClaimRequestSchema = new mongoose.Schema(
  {
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'listings',
      required: true,
      index: true,
    },
    requestType: {
      type: String,
      enum: ListingClaimRequestType,
      required: true,
    },
    status: {
      type: String,
      enum: ListingClaimRequestStatus,
      default: 'pending',
      index: true,
    },
    requester: {
      type: requesterSnapshotSchema,
      required: true,
    },
    listingSnapshot: {
      type: listingSnapshotSchema,
      required: true,
    },
    message: {
      type: String,
      required: true,
      maxlength: 4000,
    },
    proposedChanges: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    evidenceUrls: {
      type: [String],
      default: [],
    },
    reviewedBy: {
      type: String,
      default: '',
    },
    reviewedAt: {
      type: Date,
    },
    adminNotes: {
      type: String,
      default: '',
      maxlength: 4000,
    },
  },
  {
    timestamps: true,
  },
);

listingClaimRequestSchema.index({ listingId: 1, status: 1, createdAt: -1 });
listingClaimRequestSchema.index({ 'requester.netId': 1, createdAt: -1 });

export const ListingClaimRequest = mongoose.model(
  'listingClaimRequests',
  listingClaimRequestSchema,
);

export { listingClaimRequestSchema };
