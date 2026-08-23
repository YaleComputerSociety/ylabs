import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { planRejectedResearchAreaStrip } from './stripRejectedResearchAreasCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface StripRejectedResearchAreaOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function parseStripRejectedResearchAreaArgs(
  argv: string[],
): StripRejectedResearchAreaOptions {
  const options: StripRejectedResearchAreaOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-strip-rejected-areas') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown strip-rejected-research-areas argument: ${arg}`);
    }
  }
  return options;
}

export function assertStripRejectedResearchAreaApplyAllowed(
  options: Pick<StripRejectedResearchAreaOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-strip-rejected-areas.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface StripRejectedResearchAreaResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  entitiesUpdated: number;
  valuesRemoved: number;
  reindexed: number;
  errors: number;
  samples: Array<{ slug: string; removed: string[] }>;
}

export async function runStripRejectedResearchAreas(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<StripRejectedResearchAreaResult> {
  const entities = (await ResearchEntity.find(
    { archived: { $ne: true }, researchAreas: { $exists: true, $ne: [] } },
    { _id: 1, slug: 1, researchAreas: 1 },
  ).lean()) as Array<Record<string, unknown>>;

  const result: StripRejectedResearchAreaResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    entitiesUpdated: 0,
    valuesRemoved: 0,
    reindexed: 0,
    errors: 0,
    samples: [],
  };

  const updatedIds: mongoose.Types.ObjectId[] = [];

  for (const entity of entities) {
    if (options.limit && result.entitiesUpdated >= options.limit) break;
    result.scanned += 1;
    try {
      const plan = planRejectedResearchAreaStrip(entity.researchAreas);
      if (!plan.changed) continue;
      result.valuesRemoved += plan.removed.length;
      if (result.samples.length < 50) {
        result.samples.push({ slug: String(entity.slug ?? ''), removed: plan.removed });
      }
      if (!options.dryRun) {
        await ResearchEntity.updateOne(
          { _id: entity._id },
          { $set: { researchAreas: plan.kept } },
        );
        updatedIds.push(entity._id as mongoose.Types.ObjectId);
      }
      result.entitiesUpdated += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `strip-rejected-research-areas failed for ${String(entity.slug ?? entity._id)}:`,
        sanitizeLogValue(error),
      );
    }
  }

  if (!options.dryRun && updatedIds.length > 0) {
    const refreshed = await ResearchEntity.find({ _id: { $in: updatedIds } }).lean();
    await syncEntities('researchEntity', refreshed);
    result.reindexed = refreshed.length;
  }

  return result;
}

async function main(): Promise<void> {
  const options = parseStripRejectedResearchAreaArgs(process.argv.slice(2));
  assertStripRejectedResearchAreaApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-homes:strip-rejected-research-areas',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const stripResult = await runStripRejectedResearchAreas({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result: stripResult,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved strip-rejected-research-areas report to ${safeOutput}`);
    }
    console.log(JSON.stringify(stripResult, null, 2));
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
