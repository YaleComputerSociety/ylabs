/**
 * Operator entry point for field retraction (#2542).
 *
 * The retraction population is historical: the evidence a field stopped being
 * asserted is already in the observation log, so this does not need a fresh scrape
 * to act. It exists separately from the sweep lane because the corpus-wide effect
 * of a first pass has to be readable (and refusable) before it is applied, and
 * because the sweep only ever reconciles the one source it just ran.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  fieldRetractionContracts,
  reconcileFieldRetractions,
  type FieldRetractionResult,
} from '../scrapers/fieldRetraction';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:reconcile-field-retractions';

export interface ReconcileFieldRetractionsArgs {
  apply: boolean;
  confirm: boolean;
  sources: string[];
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): ReconcileFieldRetractionsArgs {
  const args: ReconcileFieldRetractionsArgs = {
    apply: false,
    confirm: false,
    sources: [],
    maxApply: 200,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-field-retraction') args.confirm = true;
    else if (arg.startsWith('--source=')) args.sources.push(arg.slice('--source='.length));
    else if (arg === '--source') args.sources.push(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  const declared = Object.keys(fieldRetractionContracts);
  const requested = args.sources.filter(Boolean);
  for (const source of requested) {
    if (!declared.includes(source)) {
      throw new Error(
        `${source} declares no field-retraction contract. Declared sources: ${declared.join(', ') || '(none)'}`,
      );
    }
  }
  args.sources = requested.length > 0 ? requested : declared;
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

export function totalPlannedRetractions(results: FieldRetractionResult[]): number {
  return results.reduce((sum, result) => sum + result.retractions.length, 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const planned: FieldRetractionResult[] = [];
  for (const sourceName of args.sources) {
    planned.push(await reconcileFieldRetractions({ sourceName, dryRun: true }));
  }

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-field-retraction is required when --apply is set.');
    }
    const plannedCount = totalPlannedRetractions(planned);
    if (plannedCount > args.maxApply) {
      throw new Error(
        `Apply would retract ${plannedCount} field assertions, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied: FieldRetractionResult[] = [];
  if (args.apply) {
    for (const sourceName of args.sources) {
      applied.push(await reconcileFieldRetractions({ sourceName, dryRun: false }));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    sources: args.sources,
    planned: planned.map((result) => ({
      sourceName: result.sourceName,
      outcome: result.outcome,
      counts: result.counts,
      frozenFields: result.frozenFields,
      plannedRetractions: result.retractions.length,
      plannedStoredValueClears: result.retractions.filter((entry) => entry.clearsStoredValue)
        .length,
    })),
    applied: applied.map((result) => ({
      sourceName: result.sourceName,
      outcome: result.outcome,
      counts: result.counts,
      frozenFields: result.frozenFields,
      regatedEntities: result.regatedEntities,
    })),
    retractions: planned.flatMap((result) => result.retractions),
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, retractions: report.retractions.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
