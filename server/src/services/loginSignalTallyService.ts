import mongoose from 'mongoose';
import { LoginSignalTally } from '../models/loginSignalTally';
import type { LoginSignalBucket } from '../models/storedVocabularies';
import type { YaliesLookup } from './yaliesService';

const MONGO_CONNECTED = 1;

export const loginSignalBucketForLookup = (lookup: YaliesLookup): LoginSignalBucket => {
  if (lookup.kind === 'student') return lookup.signal;
  if (lookup.kind === 'unavailable') return 'yalies_unavailable';
  if (lookup.kind === 'not_found') return 'yalies_not_found';
  return 'other_or_faculty';
};

export const loginSignalTallyDate = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Never awaited by the login and never throws: a tally that cannot be written is a lost
 * count, not a failed sign-in. It skips while Mongo is disconnected rather than letting
 * mongoose buffer the write behind a login.
 */
export async function recordLoginSignal(
  bucket: LoginSignalBucket,
  now: Date = new Date(),
): Promise<void> {
  if (mongoose.connection.readyState !== MONGO_CONNECTED) return;
  try {
    await LoginSignalTally.updateOne(
      { date: loginSignalTallyDate(now) },
      { $inc: { [bucket]: 1 } },
      { upsert: true },
    );
  } catch {
    console.error('Login signal tally write failed');
  }
}
