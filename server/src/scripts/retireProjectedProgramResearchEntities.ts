/**
 * Terminal cleanup for the retired Fellowship -> ResearchEntity projection.
 *
 * The projection (removed alongside this script) was the only writer of
 * `RA_PROGRAM`/`FELLOWSHIP_PROGRAM` research entities, and each one duplicated an
 * authoritative `Fellowship` record that still lives on `/programs`. This deletes
 * those derived entities, their derived access `Signal` rows, and their
 * Meilisearch documents. It is destructive by design and is gated behind the
 * shared apply guard plus an explicit confirmation flag; run the dry run first.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { deleteFromIndex } from '../services/meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';

const SCRIPT_NAME = 'programs:retire-projected-research-entities';

const RETIRED_PROGRAM_ENTITY_TYPES = ['RA_PROGRAM', 'FELLOWSHIP_PROGRAM'] as const;

export interface RetireProjectedProgramsCliOptions {
  apply: boolean;
  confirmRetirement: boolean;
  limit: number;
  output?: string;
}

export interface RetireProjectedProgramsReport {
  mode: 'apply' | 'dry-run';
  matched: number;
  entitiesDeleted: number;
  signalsDeleted: number;
  meiliDocumentsDeleted: number;
  byEntityType: Record<string, number>;
  errors: number;
  sample: Array<{ slug?: string; entityType?: string }>;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function parseRetireProjectedProgramsArgs(argv: string[]): RetireProjectedProgramsCliOptions {
  const options: RetireProjectedProgramsCliOptions = {
    apply: false,
    confirmRetirement: false,
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-projected-program-retirement') {
      options.confirmRetirement = true;
      continue;
    }
    if (arg.startsWith('--confirm-projected-program-retirement=')) {
      throw new Error('--confirm-projected-program-retirement does not accept a value');
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return options;
}

export function assertRetireProjectedProgramsApplyAllowed(
  options: Pick<RetireProjectedProgramsCliOptions, 'apply' | 'confirmRetirement' | 'limit'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (options.apply && !options.confirmRetirement) {
    throw new Error(
      `--confirm-projected-program-retirement is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
    env,
  });
}

export async function retireProjectedProgramResearchEntities(
  options: Pick<RetireProjectedProgramsCliOptions, 'apply' | 'limit'>,
): Promise<RetireProjectedProgramsReport> {
  const apply = options.apply === true;
  const report: RetireProjectedProgramsReport = {
    mode: apply ? 'apply' : 'dry-run',
    matched: 0,
    entitiesDeleted: 0,
    signalsDeleted: 0,
    meiliDocumentsDeleted: 0,
    byEntityType: {},
    errors: 0,
    sample: [],
  };

  const query = ResearchEntity.find({ entityType: { $in: [...RETIRED_PROGRAM_ENTITY_TYPES] } })
    .select('_id slug entityType')
    .lean();
  if (Number.isFinite(options.limit) && options.limit > 0) query.limit(options.limit);
  const entities = (await query) as Array<{ _id: unknown; slug?: string; entityType?: string }>;

  for (const entity of entities) {
    report.matched += 1;
    const entityId = serializedDocumentId(entity._id);
    const entityType = String(entity.entityType || '');
    report.byEntityType[entityType] = (report.byEntityType[entityType] || 0) + 1;
    if (report.sample.length < 20) {
      report.sample.push({ slug: entity.slug, entityType });
    }
    if (!entityId) continue;

    try {
      const signalMatch = await Signal.countDocuments({ researchEntityId: entityId });
      if (apply) {
        await Signal.deleteMany({ researchEntityId: entityId });
        await deleteFromIndex('researchEntity', entityId);
        await ResearchEntity.deleteOne({ _id: entity._id });
      }
      report.signalsDeleted += signalMatch;
      report.meiliDocumentsDeleted += 1;
      report.entitiesDeleted += 1;
    } catch (error) {
      report.errors += 1;
      console.error(
        'retireProjectedProgramResearchEntities: deletion failed:',
        sanitizeLogValue({ entityId, error }),
      );
    }
  }

  return report;
}

export function writeRetireProjectedProgramsOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const options = parseRetireProjectedProgramsArgs(process.argv.slice(2));
  const guard = assertRetireProjectedProgramsApplyAllowed(options, process.env, process.env.MONGODBURL);
  await initializeConnections();

  const result = await retireProjectedProgramResearchEntities({
    apply: options.apply,
    limit: Number.isFinite(options.limit) ? options.limit : Infinity,
  });

  const report = {
    ...result,
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  };

  console.log(JSON.stringify(report, null, 2));
  writeRetireProjectedProgramsOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config();
  main()
    .catch((error) => {
      console.error('Failed to retire projected program research entities:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
