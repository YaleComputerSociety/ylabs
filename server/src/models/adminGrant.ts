/**
 * Mongoose schema for explicit admin authority grants.
 */
import mongoose from 'mongoose';

const adminGrantSchema = new mongoose.Schema(
  {
    netid: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true,
    },
    source: {
      type: String,
      enum: ['manual', 'bootstrap'],
      default: 'manual',
    },
    grantedBy: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    grantedAt: {
      type: Date,
      default: Date.now,
    },
    revokedBy: {
      type: String,
      lowercase: true,
      trim: true,
    },
    revokedAt: {
      type: Date,
    },
    note: {
      type: String,
      default: '',
    },
    revokeNote: {
      type: String,
      default: '',
    },
  },
  {
    collection: 'admin_grants',
    timestamps: true,
  },
);

adminGrantSchema.index({ netid: 1, status: 1 });

export const AdminGrant = mongoose.model('AdminGrant', adminGrantSchema);
