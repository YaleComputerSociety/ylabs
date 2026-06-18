import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { reapExpiredPostedOpportunities } from '../services/postedOpportunityService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface PostedOpportunityStatusReaperCliOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirmPostedOpportunityStatusReaper: boolean;
  output?: string;
}

export function parsePostedOpportunityStatusReaperArgs(
  argv: string[],
): PostedOpportunityStatusReaperCliOptions {
  const options: PostedOpportunityStatusReaperCliOptions = {
    dryRun: true,
    limit: 500,
    explicitLimit: false,
    confirmPostedOpportunityStatusReaper: false,
  };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    return resolveSafeJsonReportOutputPath(value);
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
    if (arg === '--confirm-posted-opportunity-status-reaper') {
      options.confirmPostedOpportunityStatusReaper = true;
      continue;
    }
    if (arg.startsWith('--confirm-posted-opportunity-status-reaper=')) {
      throw new Error('--confirm-posted-opportunity-status-reaper does not accept a value');
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

    throw new Error(`Unknown posted-opportunity status reaper argument: ${arg}`);
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

export function writePostedOpportunityStatusReaperOutput(result: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(result, null, 2)}\n`);
}

export function assertPostedOpportunityStatusReaperApplyAllowed(
  options: PostedOpportunityStatusReaperCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (!options.dryRun && !options.explicitLimit) {
    throw new Error('--limit is required when --apply is set for opportunities:reap-statuses');
  }
  if (!options.dryRun && !options.confirmPostedOpportunityStatusReaper) {
    throw new Error(
      '--confirm-posted-opportunity-status-reaper is required when --apply is set for opportunities:reap-statuses',
    );
  }
  return assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: 'opportunities:reap-statuses',
    mongoUrl,
    env,
  });
}

export function buildPostedOpportunityStatusReaperOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: PostedOpportunityStatusReaperCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: PostedOpportunityStatusReaperCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main(): Promise<void> {
  const options = parsePostedOpportunityStatusReaperArgs(process.argv.slice(2));
  const guard = assertPostedOpportunityStatusReaperApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const result = await reapExpiredPostedOpportunities({
    dryRun: options.dryRun,
    limit: options.limit,
  });
  const output = buildPostedOpportunityStatusReaperOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writePostedOpportunityStatusReaperOutput(output, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
