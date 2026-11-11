/**
 * `research-entity:reslug-alt-text-slugs`: gives every live roster row whose slug was minted
 * from a headshot's alt text the slug of its real name, and keeps the old slug as a redirect
 * (#5808). A one-time correction: the roster lane no longer mints a key from alt text, and the
 * materializer refuses renames, so no lane can re-derive it. Development only: Beta and
 * Production receive the renamed rows by promotion.
 *
 * Dry run by default; `--apply --confirm` writes. It prints counts only, never a name or slug.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  SCRIPT_NAME,
  assertAltTextReslugApplyAllowed,
  parseAltTextReslugArgs,
  runAltTextReslug,
} from './reslugAltTextResearchEntitiesCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function main(): Promise<void> {
  const args = parseAltTextReslugArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required.');
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });
  assertAltTextReslugApplyAllowed(args, guard.dbLabel);

  await connectScriptMongo(mongoUrl);
  try {
    const result = await runAltTextReslug({ apply: args.apply });
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
