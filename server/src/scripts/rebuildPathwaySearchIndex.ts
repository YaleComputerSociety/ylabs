import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { searchPathways } from '../services/pathwaySearchService';
import { rebuildPathwaySearchIndex } from '../services/pathwaySearchIndexService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';
import { assertPathwayIndexRolloutTarget } from './pfr3RolloutCore';

export interface RebuildPathwaySearchIndexCliOptions {
  pageSize: number;
  clearExisting: boolean;
  confirmMeiliRebuild: boolean;
  output?: string;
}

export function parseRebuildPathwaySearchIndexArgs(
  argv: string[],
): RebuildPathwaySearchIndexCliOptions {
  const options: RebuildPathwaySearchIndexCliOptions = {
    pageSize: 100,
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

    throw new Error(`Unknown pathway search index rebuild argument: ${arg}`);
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

export function writeRebuildPathwaySearchIndexOutput(result: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(result, null, 2)}\n`);
}

export function assertRebuildPathwaySearchIndexAllowed(
  args: {
    env?: NodeJS.ProcessEnv;
    mongoUrl?: string;
    confirmMeiliRebuild?: boolean;
  } = {},
): ScriptApplyGuardResult {
  if (!args.confirmMeiliRebuild) {
    throw new Error('--confirm-meili-rebuild is required when rebuilding Meilisearch indexes');
  }
  return assertScriptApplyAllowed({
    apply: true,
    scriptName: 'meili:rebuild-pathways',
    mongoUrl: args.mongoUrl ?? process.env.MONGODBURL,
    env: args.env,
  });
}

export function buildRebuildPathwaySearchIndexOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: RebuildPathwaySearchIndexCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: RebuildPathwaySearchIndexCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main() {
  const options = parseRebuildPathwaySearchIndexArgs(process.argv.slice(2));
  const guard = assertRebuildPathwaySearchIndexAllowed({
    confirmMeiliRebuild: options.confirmMeiliRebuild,
  });
  const rollout = assertPathwayIndexRolloutTarget({
    environment: guard.environment,
    meiliHost: process.env.MEILISEARCH_HOST,
    indexPrefix: process.env.MEILISEARCH_INDEX_PREFIX,
    restorePoint: process.env.PFR3_MEILI_RESTORE_POINT,
  });
  await initializeConnections();

  const result = await rebuildPathwaySearchIndex(
    (page, pageSize) =>
      searchPathways({
        page,
        pageSize,
        sort: { sortBy: 'lastObservedAt', sortOrder: 'desc' },
      }),
    options,
  );
  const output = buildRebuildPathwaySearchIndexOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  Object.assign(output, { rollout });

  console.log(JSON.stringify(output, null, 2));
  writeRebuildPathwaySearchIndexOutput(output, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to rebuild pathway Meilisearch index:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
