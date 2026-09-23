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
  | 'departmentRosterHealth'
  | 'ysmLabIndexHealth'
  | 'orgUnit';

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
        'ysmLabIndexHealth',
        'orgUnit',
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
    /**
     * Fields this source POSITIVELY asserts have no value for this entity, as of
     * this run. Distinct from simply not emitting the field: a scraper omits a
     * field both when the page stopped stating it and when a guard refused a
     * value the page still states, and those are opposite facts (#2647). Only an
     * explicit entry here licenses `fieldRetraction` to retire a prior assertion.
     */
    assertsNoValueFor: {
      type: [String],
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
/**
 * Partial on live rows because the only query that reads this index is the
 * supersede pass in `appendObservations`, which always carries `superseded: false`
 * (every other reference projects or writes the fingerprint rather than filtering
 * on it). Superseded rows grow monotonically and are never looked up by
 * fingerprint, so indexing them cost 252 MB of a 584 MB index total on
 * Development, and the full index would keep growing with the dead portion.
 *
 * A query must carry the same `superseded: false` equality to use this index.
 */
observationSchema.index(
  { observationFingerprint: 1, superseded: 1 },
  { partialFilterExpression: { superseded: false } },
);
/**
 * `value` is Mixed, so it is indexed only for the one field whose values are short
 * scalar keys: the person materializer asks "does any live entity name this `user`
 * entityKey as its PI?" once per unresolved key, and without this the query has no
 * index better than `superseded_1` over ~471k rows (#2773). The partial filter keeps
 * array and long-text values out of the index, where they would risk the 1024-byte
 * index key limit; a query must carry the same `field` equality to use it.
 */
observationSchema.index(
  { value: 1, superseded: 1 },
  { partialFilterExpression: { field: 'inferredPiUserKey' } },
);

export const Observation = mongoose.model('Observation', observationSchema);

export { observationSchema };
