import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { backfillPostedOpportunitiesFromListings } from '../services/postedOpportunityService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface PostedOpportunityBackfillCliOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirmPostedOpportunityBackfill: boolean;
  output?: string;
}

export function parsePostedOpportunityBackfillArgs(
  argv: string[],
): PostedOpportunityBackfillCliOptions {
  const options: PostedOpportunityBackfillCliOptions = {
    dryRun: true,
    limit: 500,
    explicitLimit: false,
    confirmPostedOpportunityBackfill: false,
  };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.dryRun = false;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--confirm-posted-opportunity-backfill') {
      options.confirmPostedOpportunityBackfill = true;
      continue;
    }
    if (arg.startsWith('--confirm-posted-opportunity-backfill=')) {
      throw new Error('--confirm-posted-opportunity-backfill does not accept a value');
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      options.explicitLimit = true;
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

    throw new Error(`Unknown posted-opportunity backfill argument: ${arg}`);
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

export function writePostedOpportunityBackfillOutput(result: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

export function assertPostedOpportunityBackfillApplyAllowed(
  options: PostedOpportunityBackfillCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (!options.dryRun && !options.explicitLimit) {
    throw new Error('--limit is required when --apply is set for posted-opportunities:backfill');
  }
  if (!options.dryRun && !options.confirmPostedOpportunityBackfill) {
    throw new Error(
      '--confirm-posted-opportunity-backfill is required when --apply is set for posted-opportunities:backfill',
    );
  }
  return assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: 'posted-opportunities:backfill',
    mongoUrl,
    env,
  });
}

export function buildPostedOpportunityBackfillOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: PostedOpportunityBackfillCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: PostedOpportunityBackfillCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main(): Promise<void> {
  const options = parsePostedOpportunityBackfillArgs(process.argv.slice(2));
  const guard = assertPostedOpportunityBackfillApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const result = await backfillPostedOpportunitiesFromListings({
    dryRun: options.dryRun,
    limit: options.limit,
  });
  const output = buildPostedOpportunityBackfillOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writePostedOpportunityBackfillOutput(output, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
