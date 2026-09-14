/**
 * Mongoose schema and model for dated corpus coverage and quality measurements.
 *
 * One row per measurement run, holding the ratios rendered by the admin
 * dashboard. Ratios are stored as numerator and denominator rather than a
 * percentage so a reader can never mistake a rising count for rising quality.
 * Counts only: a snapshot never carries a slug, name, or other row-level
 * identifier, per docs/person-identifier-convention.md.
 *
 * Environment-local by policy. A promotion replaces whole collections, so this
 * collection is listed in scripts/mirrorCollectionPolicy.ts and must never join
 * the promotion copy set, or every promotion would erase the history.
 */
import mongoose from 'mongoose';

const ratioSchema = new mongoose.Schema(
  {
    n: { type: Number, required: true },
    of: { type: Number, required: true },
  },
  { _id: false },
);

const corpusQualitySnapshotSchema = new mongoose.Schema(
  {
    measuredAt: {
      type: Date,
      required: true,
      default: () => new Date(),
      index: true,
    },
    environment: {
      type: String,
      required: true,
      index: true,
    },
    databaseName: {
      type: String,
      required: true,
    },
    surface: {
      type: String,
      required: true,
    },
    coverage: {
      entities: { type: Number, required: true },
      archived: { type: Number, required: true },
      studentReady: { type: Number, required: true },
      byTier: [
        {
          _id: false,
          tier: { type: String, required: true },
          count: { type: Number, required: true },
        },
      ],
      studentReadyBySchool: [
        {
          _id: false,
          school: { type: String, required: true },
          count: { type: Number, required: true },
        },
      ],
    },
    richness: {
      hasResearchHome: { type: ratioSchema, required: true },
      hasResearchArea: { type: ratioSchema, required: true },
      hasSourceUrl: { type: ratioSchema, required: true },
      researchAreaTotal: { type: ratioSchema, required: true },
      noResearchHomeAndNoResearchArea: { type: ratioSchema, required: true },
    },
    description: {
      fullDescriptionUseful: { type: ratioSchema, required: true },
      shortDescriptionUseful: { type: ratioSchema, required: true },
      leadSentenceStatesResearch: { type: ratioSchema, required: true },
      shortDescriptionIsAreaEchoOnly: { type: ratioSchema, required: true },
      nameIsGenericFacultyResearchTitle: { type: ratioSchema, required: true },
    },
    integrity: {
      publicDescriptionInvariantFails: { type: ratioSchema, required: true },
    },
  },
  { timestamps: true },
);

corpusQualitySnapshotSchema.index({ environment: 1, measuredAt: -1 });

export const CORPUS_QUALITY_SNAPSHOT_COLLECTION = 'corpus_quality_snapshots';

export const CorpusQualitySnapshot = mongoose.model(
  'CorpusQualitySnapshot',
  corpusQualitySnapshotSchema,
  CORPUS_QUALITY_SNAPSHOT_COLLECTION,
);
