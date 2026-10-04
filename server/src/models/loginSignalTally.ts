/**
 * One row per UTC day counting how many CAS logins fell into each personalization-signal
 * bucket (#4744), so the reach of major-based browse personalization can be measured
 * without storing anything about any student.
 *
 * A row holds the date and integer counts only: no netid, account id, major, curriculum or
 * time finer than the day, which is why `timestamps` and the version key are off.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: a copied tally
 * would attribute one environment's logins to another. Remove the collection once the
 * personalization decision recorded in docs/decisions.md is made.
 */
import mongoose from 'mongoose';
import { loginSignalBuckets } from './storedVocabularies';

export const LOGIN_SIGNAL_TALLY_COLLECTION = 'login_signal_tallies';

const bucketCounts = Object.fromEntries(
  loginSignalBuckets.map((bucket) => [bucket, { type: Number, min: 0, default: 0 }]),
);

const loginSignalTallySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    ...bucketCounts,
  },
  { strict: 'throw', timestamps: false, versionKey: false },
);

loginSignalTallySchema.index({ date: 1 }, { unique: true });

export const LoginSignalTally = mongoose.model(
  'LoginSignalTally',
  loginSignalTallySchema,
  LOGIN_SIGNAL_TALLY_COLLECTION,
);
