/**
 * A deletion made in one environment, waiting to be carried to the others (#4156).
 *
 * Accounts are environment-local and the web service holds no other environment's
 * credentials, so a deletion removes the local rows and leaves one of these behind; the
 * `accounts:delete-account-data` operator script then deletes the same person in each other
 * environment and marks it done there. The person is named only by `subjectHash`, the keyed
 * hash of the netid under the source environment's `ACCOUNT_DELETION_AUDIT_HMAC_KEY`, never
 * by the netid.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: each request
 * belongs to the environment that recorded it.
 */
import mongoose from 'mongoose';
import '../db/devWriteGuard';

export const ACCOUNT_DELETION_REQUEST_COLLECTION = 'account_deletion_requests';

export const accountDeletionEnvironments = ['development', 'beta', 'production'] as const;
export type AccountDeletionEnvironment = (typeof accountDeletionEnvironments)[number];

const completedEnvironmentSchema = new mongoose.Schema(
  {
    environment: { type: String, enum: [...accountDeletionEnvironments], required: true },
    completedAt: { type: Date, required: true },
    matched: { type: Boolean, required: true },
  },
  { _id: false },
);

const accountDeletionRequestSchema = new mongoose.Schema(
  {
    subjectHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    sourceEnvironment: { type: String, enum: [...accountDeletionEnvironments], required: true },
    requester: { type: String, enum: ['account_holder', 'operator'], required: true },
    requestedAt: { type: Date, required: true },
    pendingEnvironments: {
      type: [{ type: String, enum: [...accountDeletionEnvironments] }],
      default: [],
    },
    completedEnvironments: { type: [completedEnvironmentSchema], default: [] },
  },
  { strict: 'throw', timestamps: false, versionKey: false },
);

accountDeletionRequestSchema.index({ pendingEnvironments: 1, requestedAt: 1 });
accountDeletionRequestSchema.index({ subjectHash: 1 });

export const AccountDeletionRequest = mongoose.model(
  'AccountDeletionRequest',
  accountDeletionRequestSchema,
  ACCOUNT_DELETION_REQUEST_COLLECTION,
);
