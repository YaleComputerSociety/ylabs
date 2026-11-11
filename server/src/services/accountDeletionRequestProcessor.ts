import type { Db } from 'mongodb';
import mongoose from 'mongoose';
import type { AccountDeletionEnvironment } from '../models/accountDeletionRequest';
import { AccountDataDeletionBlockedError, deleteAccountData } from './accountDataService';
import {
  markDeletionRequestDone,
  netidsBySubjectHash,
  pendingDeletionRequests,
} from './accountDeletionRequestService';
import { PostHogPersonDeletionError } from './posthogPersonDeletionService';

export interface PendingDeletionProcessingSummary {
  pending: number;
  matched: number;
  deleted: number;
  markedDone: number;
  failed: number;
}

const isRequestLocalFailure = (error: unknown): boolean =>
  error instanceof AccountDataDeletionBlockedError || error instanceof PostHogPersonDeletionError;

/**
 * Deletes, in the environment the default connection serves, every person a request in the
 * source database is waiting on. A request whose hash matches no netid here is still marked
 * done, because there is nothing of that person to delete in this environment.
 */
export const processPendingDeletionRequests = async ({
  sourceDb,
  sourceKey,
  target,
  targetServiceEnv,
  apply,
  now = new Date(),
}: {
  sourceDb: Db;
  sourceKey: string;
  target: AccountDeletionEnvironment;
  targetServiceEnv: NodeJS.ProcessEnv;
  apply: boolean;
  now?: Date;
}): Promise<PendingDeletionProcessingSummary> => {
  const targetDb = mongoose.connection.db;
  if (!targetDb) throw new Error('Mongo is not connected');
  const requests = await pendingDeletionRequests(sourceDb, target);
  const byHash = requests.length > 0 ? await netidsBySubjectHash(targetDb, sourceKey) : new Map();
  const summary: PendingDeletionProcessingSummary = {
    pending: requests.length,
    matched: 0,
    deleted: 0,
    markedDone: 0,
    failed: 0,
  };
  for (const request of requests) {
    const netid = byHash.get(request.subjectHash);
    if (netid) summary.matched += 1;
    if (!apply) continue;
    if (netid) {
      try {
        await deleteAccountData(netid, {
          requester: 'operator',
          env: targetServiceEnv,
          now,
          environment: target,
          requestOtherEnvironments: false,
        });
      } catch (error) {
        if (!isRequestLocalFailure(error)) throw error;
        summary.failed += 1;
        continue;
      }
      summary.deleted += 1;
    }
    await markDeletionRequestDone(sourceDb, request._id, target, Boolean(netid), now);
    summary.markedDone += 1;
  }
  return summary;
};
