import type { Db, MongoClient } from 'mongodb';
import {
  measureClusterStorageFromDb,
  resolveStorageHeadroomConfig,
  type DatabaseStorage,
  type StorageHeadroomConfig,
} from './scraperSweepPreflight';
import { stagedSwapCollectionExists } from './stagedCollectionSwap';
import {
  BETA_DATABASE_NAME,
  DEVELOPMENT_DATABASE_NAME,
  PRODUCTION_DATABASE_NAME,
} from './databaseCopyPairs';

export const SHARED_CLUSTER_DATABASE_NAMES: readonly string[] = [
  DEVELOPMENT_DATABASE_NAME,
  BETA_DATABASE_NAME,
  PRODUCTION_DATABASE_NAME,
];

export interface SwapStorage {
  client: MongoClient;
  config?: StorageHeadroomConfig;
  requiredDatabaseNames?: readonly string[];
}

const BYTES_PER_MB = 1024 * 1024;

export interface StagedSwapHeadroomVerdict {
  ok: boolean;
  usedMb: number;
  stagingMb: number;
  quotaMb: number;
  headroomAfterStagingMb: number;
  minHeadroomMb: number;
  databases: DatabaseStorage[];
  message: string;
}

export async function collectionFootprintMb(db: Db, collectionName: string): Promise<number> {
  if (!(await stagedSwapCollectionExists(db, collectionName))) return 0;
  const [stats] = await db
    .collection(collectionName)
    .aggregate<{ storageStats?: { size?: number; totalIndexSize?: number } }>([
      { $collStats: { storageStats: {} } },
    ])
    .toArray();
  const bytes =
    Number(stats?.storageStats?.size ?? 0) + Number(stats?.storageStats?.totalIndexSize ?? 0);
  return bytes / BYTES_PER_MB;
}

export async function collectionsFootprintMb(
  db: Db,
  collectionNames: readonly string[],
): Promise<number> {
  let total = 0;
  for (const name of collectionNames) total += await collectionFootprintMb(db, name);
  return total;
}

export function evaluateStagedSwapHeadroom(input: {
  usedMb: number;
  stagingMb: number;
  databases?: DatabaseStorage[];
  config: StorageHeadroomConfig;
  label: string;
  remedy?: string;
}): StagedSwapHeadroomVerdict {
  const headroomAfterStagingMb = input.config.clusterQuotaMb - input.usedMb - input.stagingMb;
  const ok = headroomAfterStagingMb >= input.config.minHeadroomMb;
  const figures = `${Math.round(input.usedMb)} MB of ${Math.round(input.config.clusterQuotaMb)} MB used across every database on the cluster, plus ${Math.round(input.stagingMb)} MB of staging, leaves ${Math.round(headroomAfterStagingMb)} MB`;
  return {
    ok,
    usedMb: input.usedMb,
    stagingMb: input.stagingMb,
    quotaMb: input.config.clusterQuotaMb,
    headroomAfterStagingMb,
    minHeadroomMb: input.config.minHeadroomMb,
    databases: input.databases ?? [],
    message: ok
      ? `${input.label}: ${figures}; at least ${input.config.minHeadroomMb} MB required`
      : `${input.label} refused before writing: ${figures}, below the ${input.config.minHeadroomMb} MB every environment on the shared cluster needs (#4149). ${input.remedy ?? 'Free space first.'}`,
  };
}

export async function measureStagedSwapHeadroom(
  input: SwapStorage & { stagingMb: number; label: string; remedy?: string },
): Promise<StagedSwapHeadroomVerdict> {
  const storage = await measureClusterStorageFromDb(input.client.db(), (name) =>
    input.client.db(name),
  );
  const verdict = evaluateStagedSwapHeadroom({
    usedMb: storage.usedMb,
    stagingMb: input.stagingMb,
    databases: storage.databases,
    config: input.config ?? resolveStorageHeadroomConfig(),
    label: input.label,
    remedy: input.remedy,
  });
  const listed = new Set(storage.databases.map((database) => database.name));
  const unseen = (input.requiredDatabaseNames ?? SHARED_CLUSTER_DATABASE_NAMES).filter(
    (name) => !listed.has(name),
  );
  if (unseen.length === 0) return verdict;
  return {
    ...verdict,
    ok: false,
    message: `${input.label} refused before writing: this credential cannot see ${unseen.join(', ')}, so the shared cluster's usage cannot be measured; a database-scoped user lists only its own database. Run it with a credential that holds listDatabases on the cluster.`,
  };
}

export async function assertStagedSwapHeadroom(
  input: Parameters<typeof measureStagedSwapHeadroom>[0],
): Promise<StagedSwapHeadroomVerdict> {
  const verdict = await measureStagedSwapHeadroom(input);
  if (!verdict.ok) throw new Error(verdict.message);
  return verdict;
}
