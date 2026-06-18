import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { rebuildResearchEntitySearchIndex } from '../services/researchEntitySearchIndexService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';

dotenv.config();

export interface RebuildResearchEntitySearchIndexCliOptions {
  pageSize: number;
  clearExisting: boolean;
  confirmMeiliRebuild: boolean;
  output?: string;
}

export function parseRebuildResearchEntitySearchIndexArgs(
  argv: string[],
): RebuildResearchEntitySearchIndexCliOptions {
  const options: RebuildResearchEntitySearchIndexCliOptions = {
    pageSize: 250,
    clearExisting: false,
    confirmMeiliRebuild: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--clear') {
      options.clearExisting = true;
      continue;
    }

    if (arg === '--confirm-meili-rebuild') {
      options.confirmMeiliRebuild = true;
      continue;
    }

    if (arg.startsWith('--page-size=')) {
      options.pageSize = parsePositiveInteger(arg.slice('--page-size='.length), '--page-size');
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

    throw new Error(`Unknown research entity search index rebuild argument: ${arg}`);
  }

  return options;
}

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function writeRebuildResearchEntitySearchIndexOutput(
  result: unknown,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(result, null, 2)}\n`);
}

export function assertRebuildResearchEntitySearchIndexAllowed(args: {
  env?: NodeJS.ProcessEnv;
  mongoUrl?: string;
  confirmMeiliRebuild?: boolean;
} = {}): ScriptApplyGuardResult {
  if (!args.confirmMeiliRebuild) {
    throw new Error('--confirm-meili-rebuild is required when rebuilding Meilisearch indexes');
  }
  return assertScriptApplyAllowed({
    apply: true,
    scriptName: 'meili:rebuild-research-entities',
    mongoUrl: args.mongoUrl ?? process.env.MONGODBURL,
    env: args.env,
  });
}

export function buildRebuildResearchEntitySearchIndexOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: RebuildResearchEntitySearchIndexCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: RebuildResearchEntitySearchIndexCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main() {
  const options = parseRebuildResearchEntitySearchIndexArgs(process.argv.slice(2));
  const guard = assertRebuildResearchEntitySearchIndexAllowed({
    confirmMeiliRebuild: options.confirmMeiliRebuild,
  });
  await initializeConnections();

  const result = await rebuildResearchEntitySearchIndex(options);
  const output = buildRebuildResearchEntitySearchIndexOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writeRebuildResearchEntitySearchIndexOutput(output, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to rebuild research entity Meilisearch index:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
