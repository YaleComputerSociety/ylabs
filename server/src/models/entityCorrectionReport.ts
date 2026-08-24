/**
 * Mongoose schema and model for authenticated reader-submitted correction
 * reports against canonical ResearchEntity detail pages. Reports never publish
 * user content; they only enqueue an admin review record.
 */
import mongoose from 'mongoose';

export const EntityCorrectionReportCategory = [
  'wrong_description',
  'wrong_lead',
  'wrong_research_areas',
  'stale_availability',
  'broken_link',
  'not_my_lab',
  'other',
] as const;

export const EntityCorrectionReportStatus = ['unreviewed', 'accepted', 'dismissed'] as const;

export const EntityCorrectionReporterRole = ['student', 'faculty', 'staff', 'other'] as const;

const reporterSnapshotSchema = new mongoose.Schema(
  {
    netId: { type: String, required: true },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    userType: { type: String, default: 'unknown' },
    role: {
      type: String,
      enum: EntityCorrectionReporterRole,
      default: 'other',
    },
  },
  { _id: false },
);

const entitySnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    kind: { type: String, default: '' },
    entityType: { type: String, default: '' },
  },
  { _id: false },
);

const entityCorrectionReportSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'researchEntities',
      required: true,
      index: true,
    },
    entitySlug: {
      type: String,
      required: true,
      index: true,
    },
    entitySnapshot: {
      type: entitySnapshotSchema,
      required: true,
    },
    category: {
      type: String,
      enum: EntityCorrectionReportCategory,
      required: true,
    },
    note: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    reporter: {
      type: reporterSnapshotSchema,
      required: true,
    },
    status: {
      type: String,
      enum: EntityCorrectionReportStatus,
      default: 'unreviewed',
      index: true,
    },
    reviewedBy: {
      type: String,
      default: '',
    },
    reviewedAt: {
      type: Date,
    },
    reviewerNote: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    reviewHistory: {
      type: [
        new mongoose.Schema(
          {
            status: { type: String, enum: EntityCorrectionReportStatus, required: true },
            note: { type: String, default: '' },
            reviewedBy: { type: String, required: true },
            reviewedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

entityCorrectionReportSchema.index({ status: 1, createdAt: -1 });
entityCorrectionReportSchema.index({ researchEntityId: 1, status: 1, createdAt: -1 });
entityCorrectionReportSchema.index({ 'reporter.netId': 1, createdAt: -1 });
entityCorrectionReportSchema.index(
  { researchEntityId: 1, category: 1, 'reporter.netId': 1 },
  { unique: true, partialFilterExpression: { status: 'unreviewed' } },
);

export const EntityCorrectionReport = mongoose.model(
  'entityCorrectionReports',
  entityCorrectionReportSchema,
);

export { entityCorrectionReportSchema };
