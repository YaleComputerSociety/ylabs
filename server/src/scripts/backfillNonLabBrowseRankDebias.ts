import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-homes:backfill-non-lab-browse-rank-debias';
const SIGNAL_STRUCTURALLY_LIMITED_ENTITY_TYPES = ['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH'];

export interface BackfillNonLabBrowseRankDebiasArgs {
  apply: boolean;
  confirmNonLabBrowseRankDebias: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  output?: string;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${optionName} must be a positive integer`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function valueForFlag(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (!value?.trim() || value.trim().startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value: value.trim(), nextIndex: inline !== undefined ? index : index + 1 };
}

export function parseBackfillNonLabBrowseRankDebiasArgs(
  argv: string[],
): BackfillNonLabBrowseRankDebiasArgs {
  const options: BackfillNonLabBrowseRankDebiasArgs = {
    apply: false,
    confirmNonLabBrowseRankDebias: false,
    limit: 2000,
    limitProvided: false,
    maxApply: 2000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-non-lab-browse-rank-debias') {
      options.confirmNonLabBrowseRankDebias = true;
      continue;
    }
    if (arg.startsWith('--confirm-non-lab-browse-rank-debias=')) {
      throw new Error('--confirm-non-lab-browse-rank-debias does not accept a value');
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const parsed = valueForFlag(argv, index, '--limit');
      options.limit = parsePositiveInteger(parsed.value, '--limit');
      options.limitProvided = true;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--max-apply' || arg.startsWith('--max-apply=')) {
      const parsed = valueForFlag(argv, index, '--max-apply');
      options.maxApply = parsePositiveInteger(parsed.value, '--max-apply');
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const parsed = valueForFlag(argv, index, '--output');
      options.output = resolveSafeJsonReportOutputPath(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return options;
}

export function assertBackfillNonLabBrowseRankDebiasApplyAllowed(args: {
  apply: boolean;
  confirmNonLabBrowseRankDebias?: boolean;
  limitProvided?: boolean;
  plannedWrites: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.limitProvided) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (!args.confirmNonLabBrowseRankDebias) {
    throw new Error(
      `--confirm-non-lab-browse-rank-debias is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (args.plannedWrites > args.maxApply) {
    throw new Error(`Apply would touch ${args.plannedWrites} entities, above --max-apply.`);
  }
}

function assertConnectedToDevelopment(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertOperatorEnvironmentMatchesDatabase('development', databaseNameFromMongoUrl(mongoUrl));
}

function scoreTier(score: number): string {
  if (score >= 100) return '100+';
  if (score >= 75) return '75-99';
  if (score >= 50) return '50-74';
  if (score >= 25) return '25-49';
  if (score >= 0) return '0-24';
  return 'negative';
}

function tallyTiers(scores: number[]): Record<string, number> {
  const tiers: Record<string, number> = {};
  for (const score of scores) {
    const tier = scoreTier(score);
    tiers[tier] = (tiers[tier] || 0) + 1;
  }
  return tiers;
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const options = parseBackfillNonLabBrowseRankDebiasArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGODBURL;
  assertConnectedToDevelopment(mongoUrl);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  assertOperatorEnvironmentMatchesDatabase('development', db.databaseName);

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    entityType: { $in: SIGNAL_STRUCTURALLY_LIMITED_ENTITY_TYPES },
  })
    .select('_id browseRankScore')
    .limit(options.limit)
    .lean()) as Array<{ _id: any; browseRankScore?: number }>;

  const ids = entities.map((entity) => entity._id);
  const beforeScoreById = new Map(
    entities.map((entity) => [serializedDocumentId(entity._id) || '', entity.browseRankScore ?? 0]),
  );

  assertBackfillNonLabBrowseRankDebiasApplyAllowed({
    apply: options.apply,
    confirmNonLabBrowseRankDebias: options.confirmNonLabBrowseRankDebias,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedWrites: ids.length,
  });

  const dryRunResult = await recomputeBrowseRankForEntities(ids, { dryRun: true });
  const projectedAfterScores = [...dryRunResult.scoresByEntityId.values()];
  const beforeScores = [...beforeScoreById.values()];

  let movedUp = 0;
  let movedDown = 0;
  let unchanged = 0;
  for (const [id, projected] of dryRunResult.scoresByEntityId) {
    const before = beforeScoreById.get(id) ?? 0;
    if (projected > before) movedUp += 1;
    else if (projected < before) movedDown += 1;
    else unchanged += 1;
  }

  const applied = options.apply
    ? await recomputeBrowseRankForEntities(ids, { dryRun: false })
    : { considered: 0, updated: 0, scoresByEntityId: new Map<string, number>() };

  const afterScores = options.apply ? [...applied.scoresByEntityId.values()] : projectedAfterScores;

  const report = {
    generatedAt: new Date().toISOString(),
    databaseName: db.databaseName,
    options,
    mode: options.apply ? 'apply' : 'dry-run',
    entityTypesScoped: SIGNAL_STRUCTURALLY_LIMITED_ENTITY_TYPES,
    entitiesScanned: entities.length,
    plannedWrites: ids.length,
    dryRunProjection: {
      movedUp,
      movedDown,
      unchanged,
      beforeTierDistribution: tallyTiers(beforeScores),
      projectedAfterTierDistribution: tallyTiers(projectedAfterScores),
    },
    applied: {
      considered: applied.considered,
      updated: applied.updated,
      afterTierDistribution: options.apply ? tallyTiers(afterScores) : undefined,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  writeOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(`Failed to run ${SCRIPT_NAME}:`, sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
