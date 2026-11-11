/**
 * observations:supersede-replaced-run-emails - applies the run-scoped email latest-wins rule
 * that `appendObservations` now enforces on every write to the `user` `email` observations
 * stored before it existed (#5705), then re-derives the affected people through the engine.
 *
 *   yarn --cwd server observations:supersede-replaced-run-emails --output tmp/plan.json
 *   ALLOW_NON_PROD_SCRAPER_WRITES=true OPENAI_API_KEY= yarn --cwd server observations:supersede-replaced-run-emails \
 *     --apply --confirm-supersede-replaced-run-emails --output tmp/apply.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { retireObservations } from '../scrapers/observationStore';
import {
  RUN_SCOPED_EMAIL_RETIREMENT_REASON,
  planRunScopedEmailSupersede,
  subjectsToRederive,
} from '../scrapers/runScopedEmailSupersede';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:supersede-replaced-run-emails';
export const CONFIRM_FLAG = '--confirm-supersede-replaced-run-emails';
const RETIRE_CHUNK = 500;

export function parseSupersedeReplacedRunEmailsArgs(argv: string[]): {
  apply: boolean;
  confirmed: boolean;
  output?: string;
} {
  const options: { apply: boolean; confirmed: boolean; output?: string } = {
    apply: false,
    confirmed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

function countBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[key(item)] = (counts[key(item)] ?? 0) + 1;
    return counts;
  }, {});
}

async function loadLiveEmailRows() {
  const docs = (await Observation.find({
    entityType: 'user',
    field: 'email',
    superseded: false,
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id sourceName entityKey entityId sourceUrl scrapeRunId observedAt value')
    .lean()) as unknown as Array<Record<string, unknown>>;
  return docs.map((doc) => ({
    id: String(doc._id),
    sourceName: String(doc.sourceName ?? ''),
    entityKey: serializedDocumentId(doc.entityKey),
    entityId: serializedDocumentId(doc.entityId),
    sourceUrl: typeof doc.sourceUrl === 'string' ? doc.sourceUrl : undefined,
    scrapeRunId: serializedDocumentId(doc.scrapeRunId),
    observedAt: doc.observedAt,
    value: doc.value,
  }));
}

async function main(): Promise<void> {
  const options = parseSupersedeReplacedRunEmailsArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({ apply: options.apply, scriptName: SCRIPT_NAME });
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  if (options.apply && process.env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    throw new Error(`${SCRIPT_NAME} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true.`);
  }
  await connectScriptMongo(String(process.env.MONGODBURL ?? ''));
  const databaseName = mongoose.connection.db?.databaseName;
  if (options.apply && databaseName !== 'Development') {
    throw new Error(`${SCRIPT_NAME} applies to Development only; connected to ${databaseName}.`);
  }
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${options.apply ? 'apply' : 'dry-run'}`,
  );

  const rows = await loadLiveEmailRows();
  const retirements = planRunScopedEmailSupersede(rows);
  const subjects = subjectsToRederive(retirements);

  let retired = 0;
  let rederived = 0;
  let fieldsWritten = 0;
  const rederiveErrors: string[] = [];
  if (options.apply && retirements.length > 0) {
    const ids = retirements.map((retirement) => new mongoose.Types.ObjectId(retirement.id));
    for (let start = 0; start < ids.length; start += RETIRE_CHUNK) {
      const result = await retireObservations(
        { _id: { $in: ids.slice(start, start + RETIRE_CHUNK) } },
        RUN_SCOPED_EMAIL_RETIREMENT_REASON,
      );
      retired += result.retired;
    }
    for (const identifier of subjects) {
      try {
        const result = (await materializeEntity('user', identifier, { dryRun: false })) as {
          fieldsWritten?: number;
        };
        rederived += 1;
        fieldsWritten += result?.fieldsWritten ?? 0;
      } catch (error) {
        rederiveErrors.push(sanitizeLogValue((error as Error)?.message ?? String(error)));
      }
    }
  }

  const report = {
    script: SCRIPT_NAME,
    generatedAt: new Date().toISOString(),
    databaseName,
    mode: options.apply ? 'apply' : 'dry-run',
    liveEmailObservations: rows.length,
    plannedRetirements: retirements.length,
    plannedBySourceName: countBy(retirements, (retirement) => retirement.sourceName),
    plannedSubjects: subjects.length,
    retired: options.apply ? retired : null,
    rederivedSubjects: options.apply ? rederived : null,
    fieldsWritten: options.apply ? fieldsWritten : null,
    rederiveErrors: options.apply ? rederiveErrors.length : null,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(
      options.output,
      `${JSON.stringify(
        {
          ...report,
          retirements: retirements.map(({ id, sourceName, retiredByRunId }) => ({
            id,
            sourceName,
            retiredByRunId,
          })),
          rederiveErrorMessages: rederiveErrors,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
