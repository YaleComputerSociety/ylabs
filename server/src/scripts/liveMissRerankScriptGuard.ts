import mongoose from 'mongoose';

import { devWriteLeaseSwitchedOff, resolveDevWriteLeaseTarget } from '../db/devWriteLease';
import { isSearchRerankLiveMissEnabled } from '../services/searchRerankLiveMiss';

export class LiveMissRerankRefusedError extends Error {
  constructor(scriptName: string) {
    super(
      `${scriptName} refused: SEARCH_RERANK_LIVE_MISS_ENABLED=true would queue live-miss jobs that pay for a model call and then write search_rerank_cache, which this script may not write on Development without the write lease (#5871). Unset the flag to measure, or seed the cache with DEV_WRITE_OWNER=<your session name> yarn --cwd server research-search:seed-rerank-cache --apply. Nothing was written.`,
    );
    this.name = 'LiveMissRerankRefusedError';
  }
}

type ConnectionTarget = Pick<mongoose.Connection, 'name' | 'host'> & {
  db?: { databaseName: string } | null;
};

export function assertLiveMissRerankOffForUnleasedScript(
  scriptName: string,
  connection: ConnectionTarget = mongoose.connection,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isSearchRerankLiveMissEnabled(env) || devWriteLeaseSwitchedOff(env)) return;
  const databaseName = connection.db?.databaseName || connection.name;
  if (!databaseName) return;
  if (resolveDevWriteLeaseTarget({ databaseName, host: connection.host }).kind !== 'development') {
    return;
  }
  throw new LiveMissRerankRefusedError(scriptName);
}
