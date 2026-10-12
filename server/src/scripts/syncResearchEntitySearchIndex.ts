import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { reconcileResearchEntitySearchIndex } from '../services/researchEntitySearchIndexService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { writeRebuildResearchEntitySearchIndexOutput } from './rebuildResearchEntitySearchIndex';

dotenv.config({ quiet: true });

export interface SyncResearchEntitySearchIndexCliOptions {
  apply: boolean;
  pageSize: number;
  output?: string;
}

export function parseSyncResearchEntitySearchIndexArgs(
  argv: string[],
): SyncResearchEntitySearchIndexCliOptions {
  const options: SyncResearchEntitySearchIndexCliOptions = { apply: false, pageSize: 250 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--page-size=')) {
      const value = arg.slice('--page-size='.length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
        throw new Error('--page-size requires a positive integer');
      }
      options.pageSize = parsed;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown research entity search index sync argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseSyncResearchEntitySearchIndexArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'meili:sync-research-entities',
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && guard.environment !== 'development') {
    throw new Error(
      `meili:sync-research-entities writes Development only; ${guard.environment} is rebuilt by reindex:meili.`,
    );
  }
  await initializeConnections();

  const result = await reconcileResearchEntitySearchIndex(options);
  const output = {
    ...result,
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  };
  console.log(JSON.stringify(output, null, 2));
  writeRebuildResearchEntitySearchIndexOutput(output, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to sync research entity Meilisearch index:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
