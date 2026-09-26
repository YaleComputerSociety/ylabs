/**
 * Corpus-wide catch-up materialize for stranded observation keys (issue #2403).
 *
 * Closes the enumeration gap described in `catchUpMaterializeStrandedKeysCore.ts`:
 * `materializeFromRun` is scoped to one `scrapeRunId` and is reached only after
 * `orchestrator.run` returns, so a failed or killed scrape leaves its
 * observations live, unsuperseded, and never offered to a materializer, with no
 * other pass that enumerates by key.
 *
 * The population comes from `observations:audit-orphan-keys` (#2401) rather than
 * from a query written here, so this command cannot disagree with the audit about
 * which keys are stranded or what category they are in.
 *
 * Every key is materialized through the ordinary
 * `materializeEntity('researchEntity', { entityKey })` path, so all existing
 * guards still apply - the retired-`PROGRAM` skip, the merged-into-canonical
 * no-op, merge-redirect resolution, and the name-identity authority refusal. This
 * is deliberately not a new write path.
 *
 * Usage:
 *   yarn --cwd server observations:catch-up-materialize --output "$TMPDIR/catch-up.json"
 *   yarn --cwd server observations:catch-up-materialize --apply \
 *     --confirm-catch-up-materialize --limit 50 --output "$TMPDIR/catch-up.json"
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { runOrphanObservationKeyAudit } from './orphanObservationKeyAudit';
import {
  CATCH_UP_CONFIRM_FLAG,
  DEFAULT_CATCH_UP_LIMIT,
  assertCatchUpApplyArgs,
  classifyCatchUpOutcome,
  isCatchUpEligibleCategory,
  plannedFieldSummary,
  selectCatchUpCategories,
  summarizeCatchUpRun,
  type CatchUpArgs,
  type CatchUpKeyReport,
} from './catchUpMaterializeStrandedKeysCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:catch-up-materialize';

export function parseCatchUpMaterializeArgs(argv: string[]): CatchUpArgs {
  const args: CatchUpArgs = {
    apply: false,
    confirmed: false,
    limit: DEFAULT_CATCH_UP_LIMIT,
    onlyKeys: [],
    categories: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === CATCH_UP_CONFIRM_FLAG) args.confirmed = true;
    else if (arg === '--limit') {
      const raw = argv[(index += 1)];
      if (!raw || !/^\d+$/.test(raw)) throw new Error('--limit requires a non-negative integer');
      args.limit = Number(raw);
    } else if (arg === '--only') {
      const raw = argv[(index += 1)];
      if (!raw) throw new Error('--only requires a comma-separated list of entity keys');
      args.onlyKeys = raw
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    } else if (arg === '--category') {
      const raw = argv[(index += 1)];
      if (!raw) throw new Error('--category requires a comma-separated list of categories');
      args.categories = selectCatchUpCategories(
        raw
          .split(',')
          .map((category) => category.trim())
          .filter(Boolean),
      );
    } else if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[(index += 1)]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  assertCatchUpApplyArgs(args);
  return args;
}

async function main(): Promise<void> {
  const args = parseCatchUpMaterializeArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
  });
  console.log(
    `${SCRIPT_NAME}: environment=${guard.environment} target=${guard.dbLabel} mode=${
      args.apply ? 'APPLY' : 'dry-run'
    }`,
  );

  await mongoose.connect(mongoUrl);
  try {
    const audit = await runOrphanObservationKeyAudit();
    const eligible = audit.classifications.filter(
      (row) =>
        isCatchUpEligibleCategory(row.category) &&
        (args.categories.length === 0 || args.categories.includes(row.category)),
    );
    const selected = (
      args.onlyKeys.length > 0
        ? eligible.filter((row) => args.onlyKeys.includes(row.entityKey))
        : eligible
    ).slice(0, args.limit);

    console.log(
      `stranded keys ${audit.summary.keys}; eligible for catch-up ${eligible.length}; attempting ${selected.length}`,
    );

    const reports: CatchUpKeyReport[] = [];
    for (const row of selected) {
      const base = {
        entityKey: row.entityKey,
        category: row.category,
        liveObservationCount: row.liveObservationCount,
        materializationReach: row.materializationReach,
      };
      try {
        const result: any = await materializeEntity(
          'researchEntity',
          { entityKey: row.entityKey },
          { dryRun: !args.apply },
        );
        reports.push({
          ...base,
          outcome: classifyCatchUpOutcome(result),
          skippedReason: result?.skipped,
          entityId: result?.entityId,
          fieldsWritten: result?.fieldsWritten ?? 0,
          ...plannedFieldSummary(result?.plannedSet),
        });
      } catch (error) {
        reports.push({
          ...base,
          outcome: classifyCatchUpOutcome(null, error),
          fieldsWritten: 0,
          errorMessage: sanitizeLogValue(error),
        });
      }
    }

    const summary = summarizeCatchUpRun(reports, eligible.length);
    reportCatchUp(summary, args.apply);

    if (args.output) {
      const report = {
        generatedAt: new Date().toISOString(),
        scriptName: SCRIPT_NAME,
        environment: guard.environment,
        dbLabel: guard.dbLabel,
        mode: args.apply ? 'apply' : 'dry-run',
        strandedKeys: audit.summary.keys,
        summary,
        keys: reports,
      };
      fs.writeFileSync(args.output, JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(`\nReport written to ${args.output}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

function reportCatchUp(summary: ReturnType<typeof summarizeCatchUpRun>, apply: boolean): void {
  console.log(`\n${apply ? 'Applied' : 'Planned'} outcomes`);
  for (const [outcome, count] of Object.entries(summary.byOutcome).sort(
    (left, right) => right[1] - left[1],
  )) {
    console.log(`  ${String(count).padStart(5)}  ${outcome}`);
  }
  if (Object.keys(summary.skippedReasons).length > 0) {
    console.log('\nMaterializer skip reasons');
    for (const [reason, count] of Object.entries(summary.skippedReasons).sort(
      (left, right) => right[1] - left[1],
    )) {
      console.log(`  ${String(count).padStart(5)}  ${reason}`);
    }
  }
  console.log('\nBy category');
  for (const [category, outcomes] of Object.entries(summary.byCategory)) {
    console.log(`  ${category}: ${JSON.stringify(outcomes)}`);
  }
  console.log(
    `\neligible ${summary.eligibleKeys}; attempted ${summary.attemptedKeys}; live observations on attempted keys ${summary.liveObservationsOnAttemptedKeys}`,
  );
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`${SCRIPT_NAME} failed: ${sanitizeLogValue(error)}`);
    process.exit(1);
  });
}
