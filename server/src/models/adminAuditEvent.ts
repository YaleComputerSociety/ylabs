/**
 * Append-only audit record for privileged operator/admin mutations.
 */
import mongoose from 'mongoose';

const adminAuditEventSchema = new mongoose.Schema(
  {
    actorNetid: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      trim: true,
      index: true,
    },
    targetId: {
      type: String,
      trim: true,
      index: true,
    },
    summary: {
      type: mongoose.Schema.Types.Mixed,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'admin_audit_events',
    timestamps: false,
  },
);

adminAuditEventSchema.index({ actorNetid: 1, timestamp: -1 });
adminAuditEventSchema.index({ action: 1, timestamp: -1 });
adminAuditEventSchema.index({ targetType: 1, targetId: 1, timestamp: -1 });
adminAuditEventSchema.index({ timestamp: -1 });

export const AdminAuditEvent = mongoose.model(
  'AdminAuditEvent',
  adminAuditEventSchema,
  'admin_audit_events',
);
