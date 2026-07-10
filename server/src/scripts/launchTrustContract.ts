import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import {
  runLaunchTrustContractAudit,
  type LaunchTrustContractOptions,
  type LaunchTrustMode,
} from '../services/launchTrustContractService';
import type { StudentVisibilityGateCollection } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

interface CliOptions extends LaunchTrustContractOptions {
  strict: boolean;
  output?: string;
}

const __filename = fileURLToPath(import.meta.url);

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseRequiredValue(value: string | undefined, flag: string, requirement = 'a value'): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('--')) {
    throw new Error(`${flag} requires ${requirement}`);
  }
  return trimmed;
}

export function parseLaunchTrustContractArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    collection: 'all',
    mode: 'student-ready-only',
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--include-research-activity') {
      options.includeResearchActivity = true;
    } else if (arg === '--include-paper-quality') {
      options.includePaperQuality = true;
    } else if (arg === '--mode=student-ready-only' || arg === '--student-ready-only') {
      options.mode = 'student-ready-only';
    } else if (arg === '--mode=public-safe' || arg === '--public-safe') {
      options.mode = 'public-safe';
    } else if (
      arg === '--collection=research' ||
      arg === '--collection=programs' ||
      arg === '--collection=all'
    ) {
      options.collection = arg.slice('--collection='.length) as StudentVisibilityGateCollection;
    } else if (arg.startsWith('--source=')) {
      options.sourceName = parseRequiredValue(arg.slice('--source='.length), '--source');
    } else if (arg.startsWith('--record-id=')) {
      options.recordIds = [
        ...(options.recordIds || []),
        parseRequiredValue(arg.slice('--record-id='.length), '--record-id'),
      ];
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.recordIds = options.recordIds?.filter(Boolean);
  options.mode = options.mode as LaunchTrustMode;
  return options;
}

export function writeLaunchTrustContractOutput(value: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildLaunchTrustContractOutput(
  target: { environment: string; db: string; options?: CliOptions },
  report: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  return {
    generatedAt: now.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
  };
}

async function main() {
  const options = parseLaunchTrustContractArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'launchTrustContract',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const report = await runLaunchTrustContractAudit(options);
  const output = buildLaunchTrustContractOutput(
    { environment: guard.environment, db: guard.dbLabel, options },
    report as unknown as Record<string, unknown>,
  );

  writeLaunchTrustContractOutput(output, options.output);
  console.log(JSON.stringify(output, null, 2));

  if (options.strict && !report.pass) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run launch trust contract audit:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
