/**
 * One row per identifier of a person who asked to be removed from the directory (#4160).
 *
 * A row holds a keyed HMAC digest and never the identifier, the person's name, or any
 * free text, so a copy of the collection cannot be read without the key held in
 * `DIRECTORY_REMOVAL_KEY` (utils/directoryRemovalDigest.ts).
 *
 * Copied by promotion, listed in scripts/promoteAcceptedBetaCopy.ts and
 * scripts/syncBetaToDevelopment.ts: entries are recorded on Development and reach Beta
 * and Production with the corpus they suppress (docs/release-process.md).
 */
import mongoose from 'mongoose';
import '../db/devWriteGuard';
import { DIRECTORY_REMOVAL_DIGEST, directoryRemovalKinds } from '../utils/directoryRemovalDigest';

export const DIRECTORY_REMOVAL_COLLECTION = 'directory_removals';

export const directoryRemovalWithdrawalReasons = [
  'requester_withdrew',
  'recorded_in_error',
] as const;
export type DirectoryRemovalWithdrawalReason = (typeof directoryRemovalWithdrawalReasons)[number];

const directoryRemovalSchema = new mongoose.Schema(
  {
    digest: { type: String, required: true, match: DIRECTORY_REMOVAL_DIGEST },
    kind: { type: String, required: true, enum: [...directoryRemovalKinds] },
    recordedAt: { type: Date, required: true },
    withdrawnAt: { type: Date, required: false },
    withdrawnReason: {
      type: String,
      required: false,
      enum: [...directoryRemovalWithdrawalReasons],
    },
  },
  { strict: 'throw', timestamps: false, versionKey: false },
);

directoryRemovalSchema.index({ digest: 1 }, { unique: true });

export const DirectoryRemoval = mongoose.model(
  'DirectoryRemoval',
  directoryRemovalSchema,
  DIRECTORY_REMOVAL_COLLECTION,
);
