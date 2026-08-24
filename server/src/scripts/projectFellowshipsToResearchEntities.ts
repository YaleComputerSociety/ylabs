import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { projectAllStudentReadyFellowships } from '../services/fellowshipResearchEntityProjectionService';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'programs:project-research-entities';

export interface ProjectFellowshipsCliOptions {
  apply: boolean;
  confirmProjection: boolean;
  limit: number;
  output?: string;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function parseProjectFellowshipsArgs(argv: string[]): ProjectFellowshipsCliOptions {
  const options: ProjectFellowshipsCliOptions = {
    apply: false,
    confirmProjection: false,
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-program-research-entity-projection') {
      options.confirmProjection = true;
      continue;
    }
    if (arg.startsWith('--confirm-program-research-entity-projection=')) {
      throw new Error('--confirm-program-research-entity-projection does not accept a value');
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

export function assertProjectFellowshipsApplyAllowed(
  options: Pick<ProjectFellowshipsCliOptions, 'apply' | 'confirmProjection' | 'limit'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (options.apply && !options.confirmProjection) {
    throw new Error(
      `--confirm-program-research-entity-projection is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl,
    env,
  });
}

export function writeProjectFellowshipsOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const options = parseProjectFellowshipsArgs(process.argv.slice(2));
  const guard = assertProjectFellowshipsApplyAllowed(options, process.env, process.env.MONGODBURL);
  await initializeConnections();

  const result = await projectAllStudentReadyFellowships({
    apply: options.apply,
    limit: Number.isFinite(options.limit) ? options.limit : undefined,
  });

  const report = {
    ...result,
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  };

  console.log(JSON.stringify(report, null, 2));
  writeProjectFellowshipsOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to project fellowships to research entities:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
