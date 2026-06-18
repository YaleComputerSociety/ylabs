/**
 * Source-level leases for unattended scraper jobs.
 *
 * One document per environment/source pair prevents overlapping cron runs while
 * still allowing stale leases to be taken over after their expiry.
 */
import mongoose from 'mongoose';

const scrapeJobLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    environment: {
      type: String,
      required: true,
      enum: ['development', 'beta', 'production', 'test'],
    },
    sourceName: {
      type: String,
      required: true,
    },
    locked: {
      type: Boolean,
      default: false,
    },
    ownerId: {
      type: String,
      required: false,
    },
    acquiredAt: {
      type: Date,
      required: false,
    },
    heartbeatAt: {
      type: Date,
      required: false,
    },
    leaseExpiresAt: {
      type: Date,
      required: false,
    },
    releasedAt: {
      type: Date,
      required: false,
    },
    releaseReason: {
      type: String,
      enum: ['success', 'failure', 'manual'],
      required: false,
    },
    lastRunId: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

scrapeJobLockSchema.index({ environment: 1, sourceName: 1 }, { unique: true });
scrapeJobLockSchema.index({ locked: 1, leaseExpiresAt: 1 });
scrapeJobLockSchema.index({ leaseExpiresAt: 1 });

export const ScrapeJobLock = mongoose.model(
  'ScrapeJobLock',
  scrapeJobLockSchema,
  'scrape_job_locks',
);

export { scrapeJobLockSchema };
