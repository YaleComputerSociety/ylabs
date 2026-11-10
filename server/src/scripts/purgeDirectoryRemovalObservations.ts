/**
 * `directory-removal:purge-observations`: deletes the observations of every person on
 * this environment's active `directory_removals` list (#4160). It runs in one environment
 * per invocation, Development first; Beta and Production runs are approved by the owner
 * at promotion time (docs/release-process.md).
 *
 * Dry run by default. An apply needs `--apply --confirm-directory-removal-observation-purge`,
 * and a production target also needs `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true`.
 * It prints counts only, never a name, identifier, key or digest.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { loadDirectoryRemovalMatcher } from '../services/directoryRemovalMatcher';
import { readDirectoryRemovalKey } from '../utils/directoryRemovalDigest';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { runDirectoryRemovalObservationPurge } from './directoryRemovalObservationPurge';
import {
  SCRIPT_NAME,
  assertPurgeApplyConfirmed,
  assertPurgeTargetMatchesEnvironment,
  parsePurgeArgs,
  resolvePurgeMongoUrl,
} from './directoryRemovalObservationPurgeCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function main(): Promise<void> {
  const args = parsePurgeArgs(process.argv.slice(2));
  assertPurgeApplyConfirmed(args);
  const mongoUrl = resolvePurgeMongoUrl(args.environment);
  assertPurgeTargetMatchesEnvironment(args.environment, mongoUrl);
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });
  if (!readDirectoryRemovalKey()) {
    throw new Error(`${SCRIPT_NAME} needs DIRECTORY_REMOVAL_KEY to match anyone, so it refuses.`);
  }

  await connectScriptMongo(mongoUrl);
  try {
    const matcher = await loadDirectoryRemovalMatcher();
    const result = await runDirectoryRemovalObservationPurge({ matcher, apply: args.apply });
    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          generatedAt: new Date().toISOString(),
          environment: args.environment,
          db: guard.dbLabel,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
