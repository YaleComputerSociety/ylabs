import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { classifyProgram } from '../services/programClassifier';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';

dotenv.config();

export interface BackfillProgramClassificationsCliOptions {
  apply: boolean;
  confirmProgramClassificationBackfill: boolean;
  limit: number;
  output?: string;
}

function parseRequiredOutputPath(value: string | undefined): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) {
    throw new Error('--output requires a path');
  }
  return output;
}

export function parseBackfillProgramClassificationsArgs(
  argv: string[],
): BackfillProgramClassificationsCliOptions {
  const options: BackfillProgramClassificationsCliOptions = {
    apply: false,
    confirmProgramClassificationBackfill: false,
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-program-classification-backfill') {
      options.confirmProgramClassificationBackfill = true;
      continue;
    }
    if (arg.startsWith('--confirm-program-classification-backfill=')) {
      throw new Error('--confirm-program-classification-backfill does not accept a value');
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown program classification backfill argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function writeBackfillProgramClassificationsOutput(
  report: unknown,
  output?: string,
): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildBackfillProgramClassificationsOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: BackfillProgramClassificationsCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: BackfillProgramClassificationsCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function assertBackfillProgramClassificationsApplyAllowed(
  options: Pick<
    BackfillProgramClassificationsCliOptions,
    'apply' | 'confirmProgramClassificationBackfill' | 'limit'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error('--limit is required when --apply is set for programs:backfill-classification');
  }
  if (options.apply && !options.confirmProgramClassificationBackfill) {
    throw new Error(
      '--confirm-program-classification-backfill is required when --apply is set for programs:backfill-classification',
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'programs:backfill-classification',
    mongoUrl,
    env,
  });
}

async function main() {
  const options = parseBackfillProgramClassificationsArgs(process.argv.slice(2));
  const guard = assertBackfillProgramClassificationsApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  const query = Fellowship.find({ archived: { $ne: true } }).sort({ title: 1 });
  if (Number.isFinite(options.limit)) query.limit(options.limit);
  const rows = await query.lean();
  const updates: Array<{ id: string; title: string; classification: ReturnType<typeof classifyProgram> }> = [];

  for (const row of rows) {
    const classification = classifyProgram({
      title: row.title,
      competitionType: row.competitionType,
      summary: row.summary,
      description: row.description,
      applicationInformation: row.applicationInformation,
      eligibility: row.eligibility,
      additionalInformation: row.additionalInformation,
      purpose: row.purpose,
      termOfAward: row.termOfAward,
      sourceUrl: row.sourceUrl,
    });
    updates.push({ id: String(row._id), title: row.title, classification });
    if (options.apply) {
      const unset = [
        'undergraduateOnly',
        'yaleCollegeOnly',
        'compensationSummary',
        'hoursPerWeek',
        'programDates',
      ].reduce<Record<string, ''>>((acc, field) => {
        if (!(field in classification)) acc[field] = '';
        return acc;
      }, {});
      await Fellowship.updateOne(
        { _id: row._id },
        {
          $set: classification,
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
      );
    }
  }

  const counts = updates.reduce<Record<string, number>>((acc, item) => {
    const key = item.classification.studentFacingCategory;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const report = buildBackfillProgramClassificationsOutput({
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: rows.length,
    counts,
    sample: updates.slice(0, 20),
  }, {
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  });

  console.log(JSON.stringify(report, null, 2));
  writeBackfillProgramClassificationsOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill program classifications:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
