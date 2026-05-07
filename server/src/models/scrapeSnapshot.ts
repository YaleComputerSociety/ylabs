/**
 * Mongoose schema and model for caching raw scraper fetches.
 *
 * Used by the --use-cache flag in dev: rather than re-hitting external APIs on every rerun,
 * scrapers can persist raw fetched payloads here keyed by (sourceName, requestKey). TTL'd
 * automatically so the cache self-cleans.
 */
import mongoose from 'mongoose';

const scrapeSnapshotSchema = new mongoose.Schema(
  {
    sourceName: {
      type: String,
      required: true,
    },
    requestKey: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    fetchedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

scrapeSnapshotSchema.index({ sourceName: 1, requestKey: 1 }, { unique: true });
scrapeSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ScrapeSnapshot = mongoose.model(
  'scrapesnapshots',
  scrapeSnapshotSchema,
  'scrape_snapshots',
);

export { scrapeSnapshotSchema };
