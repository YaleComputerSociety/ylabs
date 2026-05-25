/**
 * First-class admin access grants.
 */
import mongoose from 'mongoose';

export const adminGrantStatuses = ['active', 'revoked'] as const;
export const adminGrantSources = ['bootstrap', 'manual', 'migration'] as const;

const adminGrantSchema = new mongoose.Schema(
  {
    netid: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: adminGrantStatuses,
      required: true,
      default: 'active',
      index: true,
    },
    source: {
      type: String,
      enum: adminGrantSources,
      required: true,
      default: 'manual',
    },
    grantedBy: {
      type: String,
      trim: true,
    },
    grantedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    revokedBy: {
      type: String,
      trim: true,
    },
    revokedAt: {
      type: Date,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  },
);

adminGrantSchema.index(
  { netid: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  },
);
adminGrantSchema.index({ status: 1, grantedAt: -1 });

export const AdminGrant = mongoose.model('AdminGrant', adminGrantSchema, 'admin_grants');
