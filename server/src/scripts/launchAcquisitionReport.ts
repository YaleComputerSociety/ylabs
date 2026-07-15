import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  buildLaunchAcquisitionReport,
  type LaunchAcquisitionReportOptions,
} from '../services/launchAcquisitionReportService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export interface LaunchAcquisitionReportCliOptions extends LaunchAcquisitionReportOptions {
  output?: string;
}

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

export function parseLaunchAcquisitionReportArgs(
  argv: string[],
): LaunchAcquisitionReportCliOptions {
  const options: LaunchAcquisitionReportCliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--stage=pi_identity') {
      options.stages = ['pi_identity'];
    } else if (arg === '--stage=action_evidence') {
      options.stages = ['action_evidence'];
    } else if (arg === '--stage=source_description') {
      options.stages = ['source_description'];
    } else if (arg === '--stage=all') {
      options.stages = ['pi_identity', 'action_evidence', 'source_description'];
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parsePositiveInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function writeLaunchAcquisitionReportOutput(report: object, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildLaunchAcquisitionReportOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: LaunchAcquisitionReportCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: LaunchAcquisitionReportCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main() {
  if (!process.env.MONGODBURL) {
    throw new Error('MONGODBURL is required for launch:acquisition-report');
  }

  const options = parseLaunchAcquisitionReportArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'launch:acquisition-report',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const report = await buildLaunchAcquisitionReport(options);
  const output = buildLaunchAcquisitionReportOutput(report, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writeLaunchAcquisitionReportOutput(output, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run launch acquisition report:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
