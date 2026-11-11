/**
 * observations:rematerialize-user-keys - re-runs the `user` materializer over a named list of
 * `user` entityKeys through the ordinary `materializeEntity('user', { entityKey })` path, so
 * every guard on that path applies and this is not a new write path (#5706, #5740).
 *
 * A dry run by default, which reports the engine's own planned paths per key. With `--apply`
 * it writes serially (several keys can join one researcher, and two saves of one document
 * race), and `--passes=2` re-runs the same keys so a settled set shows 0 writes on pass 2.
 * The report names keys, so it is written only under the temp directory.
 *
 *   yarn --cwd server observations:rematerialize-user-keys --keys-file=<keys.json> \
 *     --output=<tmp>.json
 *   yarn --cwd server observations:rematerialize-user-keys --keys-file=<keys.json> --passes=2 \
 *     --apply --confirm-rematerialize-user-keys --output=<tmp>.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  parseRematerializeUserKeysArgs,
  summarizeUserKeyPass,
  userKeysFromJson,
  type UserKeyPassRow,
} from './rematerializeUserKeysCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:rematerialize-user-keys';

async function visit(entityKey: string, apply: boolean): Promise<UserKeyPassRow> {
  try {
    const result: any = await materializeEntity('user', { entityKey }, { dryRun: !apply });
    return {
      entityKey,
      fieldsWritten: Number(result?.fieldsWritten ?? 0),
      plannedPaths: Array.isArray(result?.plannedPaths) ? result.plannedPaths : [],
      ...(result?.skipped ? { skipped: String(result.skipped) } : {}),
    };
  } catch (error) {
    return {
      entityKey,
      fieldsWritten: 0,
      plannedPaths: [],
      error: sanitizeLogValue((error as Error)?.message ?? String(error)),
    };
  }
}

async function main(): Promise<void> {
  const args = parseRematerializeUserKeysArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  const keys = userKeysFromJson(fs.readFileSync(path.resolve(args.keysFile), 'utf8'));
  const outputPath = resolveSafeJsonReportOutputPath(args.output);
  await initializeConnections();
  try {
    const passes: UserKeyPassRow[][] = [];
    for (let pass = 1; pass <= args.passes; pass += 1) {
      const rows: UserKeyPassRow[] = [];
      for (const key of keys) rows.push(await visit(key, args.apply));
      passes.push(rows);
    }
    const summaries = passes.map((rows, index) => summarizeUserKeyPass(index + 1, rows));
    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      keys: keys.length,
      passes: summaries,
    };
    fs.writeFileSync(outputPath, JSON.stringify({ ...report, rows: passes }, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
