/**
 * Mongoose schema and model for Observations: append-only fact assertions made by scrapers.
 *
 * Each Observation says "at this time, source S claimed that entity E's field F has value V."
 * The ConfidenceResolver aggregates Observations into a resolved value per (entity, field).
 */
import mongoose from 'mongoose';

/**
 * `user` and `researchGroupMember` name retired models but are live lanes: they
 * carry the person and roster provenance that materializes into Researcher and
 * RoleAssignment. Renaming those values is a separate migration over ~471k rows.
 */
export type ObservedEntityType =
  | 'user'
  | 'researchEntity'
  | 'researchEntityRelationship'
  | 'researchGroupMember'
  | 'fellowship'
  | 'departmentRosterHealth';

const observationSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: [
        'user',
        'researchEntity',
        'researchEntityRelationship',
        'researchGroupMember',
        'fellowship',
        'departmentRosterHealth',
      ],
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    entityKey: {
      type: String,
      required: false,
    },
    field: {
      type: String,
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Source',
      required: true,
    },
    sourceName: {
      type: String,
      required: true,
    },
    scrapeRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ScrapeRun',
      required: false,
    },
    sourceUrl: {
      type: String,
      required: false,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    observedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    superseded: {
      type: Boolean,
      default: false,
    },
    supersededBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Observation',
      required: false,
    },
    observationFingerprint: {
      type: String,
      required: false,
    },
    rollback: {
      rolledBackAt: { type: Date, required: false },
      reason: { type: String, maxlength: 500, required: false },
    },
  },
  {
    timestamps: true,
  },
);

observationSchema.index({ entityType: 1, entityId: 1, field: 1, observedAt: -1 });
observationSchema.index({ entityType: 1, entityKey: 1, field: 1, observedAt: -1 });
observationSchema.index({ scrapeRunId: 1 });
observationSchema.index({ sourceId: 1, observedAt: -1 });
observationSchema.index({ superseded: 1 });
observationSchema.index({ observationFingerprint: 1, superseded: 1 });

export const Observation = mongoose.model('Observation', observationSchema);

export { observationSchema };
