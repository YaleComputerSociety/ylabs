/**
 * observations:rematerialize-user-keys - re-runs the `user` materializer over a named list of
 * `user` entityKeys through the ordinary `materializeEntity('user', { entityKey })` path, so
 * every guard on that path applies and this is not a new write path (#5706, #5740).
 *
 * A dry run by default, which reports the engine's own planned paths per key. With `--apply`
 * it writes serially (several keys can join one researcher, and two saves of one document
 * race), and `--passes=2` re-runs the same keys so a settled set shows 0 writes on pass 2.
 * Because the materializer never recomputes a tier, an apply re-gates the research rows a live
 * role edge links to each person a visit wrote, and reports the merged `regate` summary and any
 * `regateError` (#6374).
 * The report names keys, so it is written only under the temp directory.
 *
 *   yarn --cwd server observations:rematerialize-user-keys --keys-file=<keys.json> \
 *     --output=<tmp>.json
 *   yarn --cwd server observations:rematerialize-user-keys --keys-file=<keys.json> --passes=2 \
 *     --apply --confirm-rematerialize-user-keys --output=<tmp>.json
 *
 * `--only-fields=<paths>` scopes the write to named researcher paths (#5816): every planned
 * path outside the expanded scope is left as stored, neither written nor deleted, and listed per
 * key under `outOfScopePaths` (#6276); a key no researcher joins mints nothing unless
 * `--mint-listed-keys` is set (#5875), and each pass
 * summary carries `plannedPathSet` and
 * `outOfScopePathSet`, so "nothing outside the scope" is a check that `plannedPathSet` is a
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
 *
 * `--mint-listed-keys` (with `--only-fields`) lets a listed key that no researcher joins mint one
 * wherever a full run's mint rules would, and only for keys in the file; each pass summary then
 * counts `keysMinting`.
 */
import { startLongRunProgress } from '../utils/longRunProgress';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections, runScriptMain } from '../db/connections';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { resetPrimaryDepartmentStatingKeysCache } from '../scrapers/primaryDepartmentStatingKeys';
import { expandUserMaterializerScope } from '../scrapers/userMaterializerFieldScope';
import { researchEntityIdsLinkedToResearchers } from '../services/researcherLinkedSearchResync';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { createChunkedRegater } from './rematerializeResearchEntitiesCore';
import {
  mergeRematerializeRegateSummaries,
  regateRematerializedEntities,
} from './rematerializeResearchEntities';
import {
  parseRematerializeUserKeysArgs,
  summarizeUserKeyPass,
  userKeysFromJson,
  visitUserKeysRegatingLinkedRows,
  type UserKeyPassRow,
} from './rematerializeUserKeysCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { writeReportFileSync } from '../utils/reportFileWriter';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:rematerialize-user-keys';

async function visit(
  entityKey: string,
  apply: boolean,
  onlyFields: readonly string[],
  mintListedUserKeys: ReadonlySet<string> | undefined,
): Promise<UserKeyPassRow> {
  try {
    const result: any = await materializeEntity(
      'user',
      { entityKey },
      {
        dryRun: !apply,
        ...(onlyFields.length > 0 ? { userWriteOnlyFields: onlyFields } : {}),
        ...(mintListedUserKeys ? { mintListedUserKeys } : {}),
      },
    );
    return {
      entityKey,
      ...(typeof result?.entityId === 'string' ? { researcherId: result.entityId } : {}),
      fieldsWritten: Number(result?.fieldsWritten ?? 0),
      plannedPaths: Array.isArray(result?.plannedPaths) ? result.plannedPaths : [],
      ...(onlyFields.length > 0
        ? { outOfScopePaths: Array.isArray(result?.outOfScopePaths) ? result.outOfScopePaths : [] }
        : {}),
      ...(result?.created === true ? { created: true as const } : {}),
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
  const mintListedUserKeys = args.mintListedKeys ? new Set(keys) : undefined;
  await initializeConnections();
  try {
    const passes: UserKeyPassRow[][] = [];
    const regater = args.apply ? createChunkedRegater(regateRematerializedEntities) : undefined;
    for (let pass = 1; pass <= args.passes; pass += 1) {
      resetPrimaryDepartmentStatingKeysCache();
      const progress = startLongRunProgress(
        `rematerialize-user-keys pass ${pass}/${args.passes}`,
        keys.length,
      );
      try {
        passes.push(
          await visitUserKeysRegatingLinkedRows({
            keys,
            visit: (key) => visit(key, args.apply, args.onlyFields, mintListedUserKeys),
            linkedResearchEntityIds: researchEntityIdsLinkedToResearchers,
            regater,
            onRow: (row) => progress.tick(Boolean(row.error)),
          }),
        );
      } finally {
        progress.stop();
      }
    }
    const regated = regater ? await regater.finish() : undefined;
    const summaries = passes.map((rows, index) => summarizeUserKeyPass(index + 1, rows));
    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      ...(args.onlyFields.length > 0
        ? { onlyFields: args.onlyFields, scope: expandUserMaterializerScope(args.onlyFields) }
        : {}),
      keys: keys.length,
      ...(args.mintListedKeys ? { mintListedKeys: true } : {}),
      passes: summaries,
      ...(regated
        ? {
            regate: mergeRematerializeRegateSummaries(regated.summaries) ?? null,
            ...(regated.error ? { regateError: regated.error } : {}),
          }
        : {}),
    };
    writeReportFileSync(outputPath, JSON.stringify({ ...report, rows: passes }, null, 2));
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
