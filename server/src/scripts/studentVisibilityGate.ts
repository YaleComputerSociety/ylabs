import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
  runStudentVisibilityGateForPlans,
  type StudentVisibilityGateCollection,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

export interface StudentVisibilityGateCliOptions {
  collection: StudentVisibilityGateCollection;
  mode: 'dry-run' | 'apply';
  confirmStudentVisibilityApply: boolean;
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
  maxApply?: number;
  output?: string;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a number`);
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseStudentVisibilityGateArgs(argv: string[]): StudentVisibilityGateCliOptions {
  const options: StudentVisibilityGateCliOptions = {
    collection: 'all',
    mode: 'dry-run',
    confirmStudentVisibilityApply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode=apply' || arg === '--apply') {
      options.mode = 'apply';
    } else if (arg === '--mode=dry-run' || arg === '--dry-run') {
      options.mode = 'dry-run';
    } else if (arg === '--confirm-student-visibility-apply') {
      options.confirmStudentVisibilityApply = true;
    } else if (arg === '--collection=research') {
      options.collection = 'research';
    } else if (arg === '--collection=programs') {
      options.collection = 'programs';
    } else if (arg === '--collection=all') {
      options.collection = 'all';
    } else if (arg.startsWith('--source=')) {
      options.sourceName = arg.slice('--source='.length).trim();
    } else if (arg.startsWith('--record-id=')) {
      options.recordIds = [...(options.recordIds || []), arg.slice('--record-id='.length).trim()];
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg.startsWith('--max-apply=')) {
      options.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
    } else if (arg === '--max-apply') {
      options.maxApply = parsePositiveInteger(argv[i + 1], '--max-apply');
      i += 1;
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const output = arg.slice('--output='.length).trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.recordIds) {
    options.recordIds = options.recordIds.filter(Boolean);
  }

  return options;
}

export function assertStudentVisibilityGateApplyConfirmed(
  options: StudentVisibilityGateCliOptions,
  plannedRecords?: number,
): void {
  if (options.mode === 'apply' && !options.confirmStudentVisibilityApply) {
    throw new Error(
      '--confirm-student-visibility-apply is required when --apply is set for student-visibility:gate.',
    );
  }
  if (options.mode === 'apply' && options.maxApply === undefined) {
    throw new Error('--max-apply is required when --apply is set for student-visibility:gate.');
  }
  if (options.mode === 'apply' && plannedRecords !== undefined && plannedRecords > options.maxApply!) {
    throw new Error(
      `Apply would update visibility for ${plannedRecords} records, above --max-apply.`,
    );
  }
}

export function writeStudentVisibilityGateOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildStudentVisibilityGateOutput(
  target: {
    environment: string;
    db: string;
    options?: StudentVisibilityGateCliOptions;
  },
  report: Record<string, unknown>,
): Record<string, unknown> {
  if (target.options) {
    assertStudentVisibilityGateApplyConfirmed(target.options);
  }
  return {
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
  };
}

async function main() {
  const options = parseStudentVisibilityGateArgs(process.argv.slice(2));
  assertStudentVisibilityGateApplyConfirmed(options);
  const guard = assertScriptApplyAllowed({
    apply: options.mode === 'apply',
    scriptName: 'studentVisibilityGate',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const plans = await planStudentVisibilityGate(options);
  const report = await runStudentVisibilityGateForPlans(plans, {
    mode: 'dry-run',
    collection: options.collection,
  });
  report.mode = options.mode;
  assertStudentVisibilityGateApplyConfirmed(options, report.scanned);
  if (options.mode === 'apply') {
    await applyStudentVisibilityGatePlans(plans);
  }

  const outputReport = buildStudentVisibilityGateOutput(
    { environment: guard.environment, db: guard.dbLabel, options },
    report as unknown as Record<string, unknown>,
  );

  console.log(JSON.stringify(outputReport, null, 2));
  writeStudentVisibilityGateOutput(outputReport, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run student visibility gate:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
