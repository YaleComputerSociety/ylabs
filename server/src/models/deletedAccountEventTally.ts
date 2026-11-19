/**
 * Aggregate counts of the analytics events a deleted account held (#4156).
 *
 * When a student deletes their account, their `analytics_events` rows are deleted and only
 * these counts survive, so the volume of that activity stays measurable. An event
 * type the analytics model no longer names is counted as `other`. A row holds
 * a UTC month, an event type and a count: no netid, account id, search text, entity id or
 * time finer than the month, which is why `timestamps` and the version key are off.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: a copied tally
 * would attribute one environment's deletions to another.
 */
import mongoose from 'mongoose';
import '../db/devWriteGuard';

export const DELETED_ACCOUNT_EVENT_TALLY_COLLECTION = 'deleted_account_event_tallies';

const deletedAccountEventTallySchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    eventType: { type: String, required: true, match: /^[a-z_]{1,40}$/ },
    count: { type: Number, required: true, min: 0, default: 0 },
  },
  { strict: 'throw', timestamps: false, versionKey: false },
);

deletedAccountEventTallySchema.index({ month: 1, eventType: 1 }, { unique: true });

export const DeletedAccountEventTally = mongoose.model(
  'DeletedAccountEventTally',
  deletedAccountEventTallySchema,
  DELETED_ACCOUNT_EVENT_TALLY_COLLECTION,
);
