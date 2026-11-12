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
 *
 * `--only-fields=<paths>` scopes the write to named researcher paths (#5816): every planned
 * path outside the expanded scope is dropped and listed per key under `droppedPaths`, a key
 * no researcher joins mints nothing, and each pass summary carries `plannedPathSet` and
 * `droppedPathSet`, so "nothing outside the scope" is a check that `plannedPathSet` is a
 * subset of the printed `scope`. Accepted paths: displayName, profile.title,
 * profile.primaryDepartment, profile.imageUrl, profile.websiteUrl, identifiers.email,
 * identifiers.emailSupport, identifiers.orcid, profileLinks, profileFieldWriters and
 * profileFieldWriters.<field>; aliases email, emailSupport, orcid, title, primaryDepartment,
 * imageUrl and websiteUrl. A display value also writes its own writer record,
 * `profileFieldWriters` alone writes only writer records, identifiers.email and
 * identifiers.emailSupport are written together, and identifiers.orcid is written with only the
 * ORCID entries of profileLinks (`profileLinks.ORCID`).
 *
 *   yarn --cwd server observations:rematerialize-user-keys --keys-file=<keys.json> \
 *     --only-fields=identifiers.email --output=<tmp>.json
 */
import { startLongRunProgress } from '../utils/longRunProgress';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections, runScriptMain } from '../db/connections';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { expandUserMaterializerScope } from '../scrapers/userMaterializerFieldScope';
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

async function visit(
  entityKey: string,
  apply: boolean,
  onlyFields: readonly string[],
): Promise<UserKeyPassRow> {
  try {
    const result: any = await materializeEntity(
      'user',
      { entityKey },
      { dryRun: !apply, ...(onlyFields.length > 0 ? { userWriteOnlyFields: onlyFields } : {}) },
    );
    return {
      entityKey,
      fieldsWritten: Number(result?.fieldsWritten ?? 0),
      plannedPaths: Array.isArray(result?.plannedPaths) ? result.plannedPaths : [],
      ...(onlyFields.length > 0
        ? { droppedPaths: Array.isArray(result?.droppedPaths) ? result.droppedPaths : [] }
        : {}),
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
      const progress = startLongRunProgress(
        `rematerialize-user-keys pass ${pass}/${args.passes}`,
        keys.length,
      );
      try {
        for (const key of keys) {
          const row = await visit(key, args.apply, args.onlyFields);
          rows.push(row);
          progress.tick(Boolean(row.error));
        }
      } finally {
        progress.stop();
      }
      passes.push(rows);
    }
    const summaries = passes.map((rows, index) => summarizeUserKeyPass(index + 1, rows));
    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      ...(args.onlyFields.length > 0
        ? { onlyFields: args.onlyFields, scope: expandUserMaterializerScope(args.onlyFields) }
        : {}),
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
  void runScriptMain(main);
}
