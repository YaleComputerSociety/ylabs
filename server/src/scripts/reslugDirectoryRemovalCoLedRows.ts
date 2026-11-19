/**
 * `directory-removal:reslug`: gives a new slug, with no redirect, to every live co-led row
 * whose slug names a lead on this environment's active `directory_removals` list while
 * another lead remains (#4160). Development only: Beta and Production receive the row with
 * the corpus copy (docs/directory-removal.md).
 *
 * Dry run by default; `--apply` writes. It prints counts only, never a name, slug, key or
 * digest.
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
import {
  SCRIPT_NAME,
  parseReslugArgs,
  runDirectoryRemovalReslug,
} from './directoryRemovalReslugCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function main(): Promise<void> {
  const args = parseReslugArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required.');
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });
  if (!readDirectoryRemovalKey()) {
    throw new Error(
      `${SCRIPT_NAME} needs DIRECTORY_REMOVAL_KEY or DIRECTORY_REMOVAL_KEY_FILE to match anyone, so it refuses.`,
    );
  }

  await connectScriptMongo(mongoUrl);
  try {
    const matcher = await loadDirectoryRemovalMatcher();
    const result = await runDirectoryRemovalReslug({ matcher, apply: args.apply });
    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          generatedAt: new Date().toISOString(),
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
