/**
 * Carries an account deletion to every environment (#4156).
 *
 * The web service deletes locally and records a request keyed by the HMAC of the netid. The
 * operator script, which alone holds each environment's credentials, reads the requests
 * pending for one target environment from the source database, finds the target's netid
 * whose hash under the source key matches, deletes it there through the same service, and
 * marks the target done on the request. Nothing here stores or prints a netid.
 */
import { createHmac } from 'node:crypto';
import type { Db } from 'mongodb';
import mongoose from 'mongoose';
import {
  AccountDeletionRequest,
  accountDeletionEnvironments,
  type AccountDeletionEnvironment,
} from '../models/accountDeletionRequest';
import {
  databaseNameFromMongoUrl,
  operatorEnvironmentForDatabaseName,
} from '../scripts/operatorDatabaseEnvironment';

export type CrossEnvironmentDeletionOutcome =
  'requested' | 'not_requested' | 'skipped_not_configured' | 'skipped_unknown_environment';

export const otherDeletionEnvironments = (
  source: AccountDeletionEnvironment,
): AccountDeletionEnvironment[] =>
  accountDeletionEnvironments.filter((environment) => environment !== source);

export const isAccountDeletionEnvironment = (value: unknown): value is AccountDeletionEnvironment =>
  typeof value === 'string' && (accountDeletionEnvironments as readonly string[]).includes(value);

export const servingDeletionEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): AccountDeletionEnvironment | null => {
  try {
    const environment = operatorEnvironmentForDatabaseName(
      databaseNameFromMongoUrl(String(env.MONGODBURL || '').trim()),
    );
    return isAccountDeletionEnvironment(environment) ? environment : null;
  } catch {
    return null;
  }
};

export const subjectHashUnderKey = (netid: string, key: string): string =>
  createHmac('sha256', key).update(netid).digest('hex');

export const recordCrossEnvironmentDeletionRequest = async ({
  subjectHash,
  sourceEnvironment,
  requester,
  now = new Date(),
}: {
  subjectHash: string | null;
  sourceEnvironment: AccountDeletionEnvironment | null;
  requester: 'account_holder' | 'operator';
  now?: Date;
}): Promise<CrossEnvironmentDeletionOutcome> => {
  if (!subjectHash) return 'skipped_not_configured';
  if (!sourceEnvironment) return 'skipped_unknown_environment';
  await AccountDeletionRequest.updateOne(
    { subjectHash, sourceEnvironment, 'pendingEnvironments.0': { $exists: true } },
    {
      $setOnInsert: {
        subjectHash,
        sourceEnvironment,
        requester,
        requestedAt: now,
        pendingEnvironments: otherDeletionEnvironments(sourceEnvironment),
        completedEnvironments: [],
      },
    },
    { upsert: true },
  );
  return 'requested';
};

interface PendingRequest {
  _id: mongoose.Types.ObjectId;
  subjectHash: string;
}

export const pendingDeletionRequests = async (
  sourceDb: Db,
  target: AccountDeletionEnvironment,
): Promise<PendingRequest[]> =>
  (await sourceDb
    .collection('account_deletion_requests')
    .find({ pendingEnvironments: target }, { projection: { subjectHash: 1 } })
    .sort({ requestedAt: 1 })
    .toArray()) as unknown as PendingRequest[];

/**
 * Every netid the target environment holds in a collection a deletion clears, so a person
 * whose only trace there is an analytics event or a report is still found.
 */
const targetNetids = async (targetDb: Db): Promise<Set<string>> => {
  const [accounts, events, reports, grants] = await Promise.all([
    targetDb.collection('accounts').distinct('netid'),
    targetDb.collection('analytics_events').distinct('netid'),
    targetDb.collection('entitycorrectionreports').distinct('reporter.netId'),
    targetDb.collection('admin_grants').distinct('netid'),
  ]);
  const netids = new Set<string>();
  for (const value of [...accounts, ...events, ...reports, ...grants]) {
    if (typeof value === 'string' && /^[A-Za-z0-9]{2,12}$/.test(value.trim())) {
      netids.add(value.trim().toLowerCase());
    }
  }
  return netids;
};

export const netidsBySubjectHash = async (
  targetDb: Db,
  sourceKey: string,
): Promise<Map<string, string>> => {
  const byHash = new Map<string, string>();
  for (const netid of await targetNetids(targetDb)) {
    byHash.set(subjectHashUnderKey(netid, sourceKey), netid);
  }
  return byHash;
};

export const markDeletionRequestDone = async (
  sourceDb: Db,
  requestId: mongoose.Types.ObjectId,
  target: AccountDeletionEnvironment,
  matched: boolean,
  now: Date = new Date(),
): Promise<void> => {
  await sourceDb
    .collection('account_deletion_requests')
    .updateOne({ _id: requestId, pendingEnvironments: target }, {
      $pull: { pendingEnvironments: target },
      $push: { completedEnvironments: { environment: target, completedAt: now, matched } },
    } as never);
};
