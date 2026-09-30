/**
 * Mongoose schema and model for Observations: append-only fact assertions made by scrapers.
 *
 * Each Observation says "at this time, source S claimed that entity E's field F has value V."
 * The ConfidenceResolver aggregates Observations into a resolved value per (entity, field).
 */
import mongoose from 'mongoose';

/**
 * The SUBJECT an observation is about. Disjoint from the product `entityType`
 * (`LAB`, `CENTER`, `FACULTY_RESEARCH_AREA`, ...), which an observation carries as
 * a VALUE under `field: 'entityType'` and never as its own subject. Measured on
 * Development: the two vocabularies overlap in 0 values, and
 * `observedSubjectTypesAreDisjointFromProductEntityTypes` pins that, because a
 * product-typed parameter handed a subject value silently takes its default branch
 * instead of failing (#210).
 *
 * `user` and `researchGroupMember` name retired models but are live lanes: they
 * carry the person and roster provenance that materializes into Researcher and
 * RoleAssignment. The names are opaque lane labels, not model lookups, so renaming
 * them across ~471k rows corrects a spelling and changes no behaviour.
 */
export const observedEntityTypes = [
  'user',
  'researchEntity',
  'researchEntityRelationship',
  'researchGroupMember',
  'fellowship',
  'departmentRosterHealth',
  'ysmLabIndexHealth',
  'centerRosterHealth',
  'orgUnit',
] as const;

export type ObservedEntityType = (typeof observedEntityTypes)[number];

const observationSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: [...observedEntityTypes],
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
/**
 * The repair queue's evidence lookup sends `sourceUrl: { $in: variants }` with a
 * descending `observedAt` sort and a limit, so `observedAt` is the second key to let
 * MongoDB merge the per-variant intervals in sort order instead of buffering the whole
 * match. Without it the planner fell back to `superseded_1` and walked 476,302 keys for
 * 7 rows (#3934).
 *
 * This index does NOT serve the host-regex read in `observationStore`, which filters
 * `sourceUrl` too. Two independent properties of that regex each defeat index bounds,
 * measured by forcing this index on Development: it is case-insensitive, and `https?`
 * gives it no fixed literal prefix. Either one alone makes the bounds the interval
 * covering every string, so the forced plan walks all 1,880,941 keys. That read is
 * served by `entityType_1_field_1_superseded_1` below instead.
 */
observationSchema.index({ sourceUrl: 1, observedAt: -1 });
/**
 * The host-filter read in `observationStore`, which cannot narrow on `sourceUrl` (above)
 * and so has to be narrowed by everything else it asks: `entityType`, a `field` `$in`, and
 * `superseded`.
 *
 * `field` sits second on purpose. The two `entityType_1_..._field_1_observedAt_-1` indexes
 * already carry the same three fields, but with `entityId` or `entityKey` between
 * `entityType` and `field`, and an unconstrained middle key takes no bounds, so `field`
 * could not narrow anything. Ordering the keys as the query asks them took the read from
 * 39,715 to 57,920 keys down to 12,284, and documents examined from 32,682 to 12,281 (#3934).
 */
observationSchema.index({ entityType: 1, field: 1, superseded: 1 });
/**
 * Source-scoped reads: the gate's two `distinct` calls and the roster lane's observed-key
 * read, which filter `sourceName` with `entityType` and (for the gate) `superseded`.
 *
 * `entityKey` and `entityId` trail the equality keys on purpose rather than as padding.
 * They are what each caller READS, so carrying them turns the roster lane's read into a
 * covered DISTINCT_SCAN (5,705 keys, 0 documents, from 433,176 of each) and lets the
 * gate's `entityId` read answer from the index (2,917 keys, 2 documents, from 40,843).
 * Dropping either trailing key costs those two wins and nothing else changes, so do not
 * trim them back to the equality prefix (#3934).
 */
observationSchema.index({ sourceName: 1, entityType: 1, superseded: 1, entityKey: 1, entityId: 1 });
/**
 * The controlled-vocabulary heading reload, which filters `sourceName` with `field` and
 * carries no `entityType`, so it cannot use the index above: on `sourceName` alone the
 * two vocabulary sources match 224,459 rows against 12,883 for the pair (#3934, #3953).
 */
observationSchema.index({ sourceName: 1, field: 1 });

export const Observation = mongoose.model('Observation', observationSchema);

export { observationSchema };
