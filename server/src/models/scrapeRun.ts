/**
 * Mongoose schema and model for tracking individual scraper invocations.
 *
 * One row per CLI/cron run of a scraper. Groups all Observations produced during that run,
 * tracks counts and errors, and supports rollback ("invalidate this run's observations").
 */
import mongoose from 'mongoose';

const scrapeRunSchema = new mongoose.Schema(
  {
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'sources',
      required: true,
    },
    sourceName: {
      type: String,
      required: true,
    },
    triggeredBy: {
      type: String,
      enum: ['cron', 'cli', 'admin'],
      default: 'cli',
    },
    startedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    finishedAt: {
      type: Date,
      required: false,
    },
    status: {
      type: String,
      enum: ['running', 'success', 'failure', 'partial'],
      default: 'running',
    },
    observationCount: {
      type: Number,
      default: 0,
    },
    entitiesObserved: {
      type: Number,
      default: 0,
    },
    entitiesCreated: {
      type: Number,
      default: 0,
    },
    entitiesUpdated: {
      type: Number,
      default: 0,
    },
    entitiesArchived: {
      type: Number,
      default: 0,
    },
    errors: {
      type: [
        {
          message: String,
          stack: String,
          context: mongoose.Schema.Types.Mixed,
          at: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
    options: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    invalidated: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  },
);

scrapeRunSchema.index({ sourceId: 1, startedAt: -1 });
scrapeRunSchema.index({ status: 1, startedAt: -1 });
scrapeRunSchema.index({ invalidated: 1 });

export const ScrapeRun = mongoose.model('scraperuns', scrapeRunSchema);

export { scrapeRunSchema };
