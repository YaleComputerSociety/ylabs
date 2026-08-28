/**
 * Reconcile deployed `grants` indexes with the schema after retiring the dead
 * `plainSummary`, `piFacultyMemberId`, `coPiFacultyMemberIds`, and `fiscalYear`
 * paths (#2145).
 *
 * MongoDB permits only one text index per collection, so the narrowed
 * `{ title, abstract, keywords }` text index cannot be created while the old
 * `{ title, abstract, plainSummary, keywords }` one is still deployed: every
 * server boot fails that autoIndex build with IndexOptionsConflict. Dropping the
 * stale indexes here lets the server's own autoIndex build the declared set on
 * its next boot, so run this before deploying the schema change.
 *
 * Text indexes report their fields in `weights` rather than in `key`, so both
 * are inspected when deciding whether a deployed index references a retired path.
 *
 * Dry-run by default. APPLY requires:
 * --apply --confirm-v4-migration
 *
 * Run from data-migration/:
 * npx tsx DropRetiredGrantIndexes.ts
 * (add --apply --confirm-v4-migration to drop)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from '../server/node_modules/mongoose';
import { assertScriptApplyAllowed } from '../server/src/scripts/scriptWriteGuards';
import {
  buildV4MigrationOutput,
  disconnectForMigration,
  parseMigrationOptions,
  type MigrationOptions,
} from './v4MigrationUtils';

const __filename = fileURLToPath(import.meta.url);

const TITLE = 'Drop retired grant indexes';
const SCRIPT_NAME = 'model-refactor:drop-retired-grant-indexes';

const RETIRED_GRANT_PATHS = [
  'plainSummary',
  'piFacultyMemberId',
  'coPiFacultyMemberIds',
  'fiscalYear',
] as const;

interface DeployedIndex {
  name: string;
  key: Record<string, unknown>;
  weights?: Record<string, unknown>;
}

export function indexedPaths(index: DeployedIndex): string[] {
  return [...Object.keys(index.key || {}), ...Object.keys(index.weights || {})];
}

export function retiredPathsInIndex(index: DeployedIndex): string[] {
  const indexed = new Set(indexedPaths(index));
  return RETIRED_GRANT_PATHS.filter((retired) => indexed.has(retired));
}

export function selectStaleGrantIndexes(indexes: DeployedIndex[]): DeployedIndex[] {
  return indexes.filter((index) => index.name !== '_id_' && retiredPathsInIndex(index).length > 0);
}

function assertApplyAllowed(options: MigrationOptions, mongoUrl: string): void {
  if (options.apply && !options.confirmV4Migration) {
    throw new Error(`--confirm-v4-migration is required when --apply is set for ${SCRIPT_NAME}`);
  }
  assertScriptApplyAllowed({ apply: options.apply, scriptName: SCRIPT_NAME, mongoUrl });
}

async function run(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2));
  const url = process.env.MONGODBURL;
  if (!url) throw new Error('MONGODBURL not set in server/.env');
  assertApplyAllowed(options, url);

  console.log(`\n=== ${TITLE} ===`);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}\n`);

  await mongoose.connect(url, { autoIndex: false });

  const collection = mongoose.connection.collection('grants');
  const deployed = (await collection.indexes()) as unknown as DeployedIndex[];
  const stale = selectStaleGrantIndexes(deployed);

  const dropped: string[] = [];
  if (options.apply) {
    for (const index of stale) {
      await collection.dropIndex(index.name);
      dropped.push(index.name);
    }
  }

  const output = buildV4MigrationOutput(
    {
      scriptName: SCRIPT_NAME,
      applied: options.apply,
      retiredPaths: [...RETIRED_GRANT_PATHS],
      deployedIndexCount: deployed.length,
      stale: stale.map((index) => ({
        name: index.name,
        retiredPaths: retiredPathsInIndex(index),
      })),
      dropped,
    },
    { db: mongoose.connection.name, options },
  );

  console.log(JSON.stringify(output, null, 2));
  if (options.output) fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);

  await disconnectForMigration();
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  run().catch(async (err) => {
    console.error(err);
    await disconnectForMigration().catch(() => undefined);
    process.exit(1);
  });
}
