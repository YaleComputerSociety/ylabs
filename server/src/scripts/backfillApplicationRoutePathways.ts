import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ContactRoute } from '../models/contactRoute';
import { ResearchEntity } from '../models/researchEntity';
import { materializeAccessForResearchGroup } from '../scrapers/accessMaterializer';
import { upsertAccessSignal } from '../services/accessSignalService';
import { upsertEntryPathway } from '../services/entryPathwayService';
import { backfillApplicationRoutePathways } from './applicationRoutePathwayBackfillCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ApplicationRoutePathwayBackfillCliOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirmApplicationRouteBackfill: boolean;
  output?: string;
}

export function parseApplicationRoutePathwayBackfillArgs(
  argv: string[],
): ApplicationRoutePathwayBackfillCliOptions {
  const options: ApplicationRoutePathwayBackfillCliOptions = {
    dryRun: true,
    limit: 150,
    explicitLimit: false,
    confirmApplicationRouteBackfill: false,
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
    if (arg === '--confirm-application-route-backfill') {
      options.confirmApplicationRouteBackfill = true;
      continue;
    }
    if (arg.startsWith('--confirm-application-route-backfill=')) {
      throw new Error('--confirm-application-route-backfill does not accept a value');
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

    throw new Error(`Unknown application-route pathway backfill argument: ${arg}`);
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

export function writeApplicationRoutePathwayBackfillOutput(
  result: unknown,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(result, null, 2)}\n`);
}

export function assertApplicationRoutePathwayBackfillApplyAllowed(
  options: ApplicationRoutePathwayBackfillCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (!options.dryRun && !options.explicitLimit) {
    throw new Error('--limit is required when --apply is set for application-routes:backfill-pathways');
  }
  if (!options.dryRun && !options.confirmApplicationRouteBackfill) {
    throw new Error(
      '--confirm-application-route-backfill is required when --apply is set for application-routes:backfill-pathways',
    );
  }
  return assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: 'application-routes:backfill-pathways',
    mongoUrl,
    env,
  });
}

export function buildApplicationRoutePathwayBackfillOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ApplicationRoutePathwayBackfillCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: ApplicationRoutePathwayBackfillCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main(): Promise<void> {
  const options = parseApplicationRoutePathwayBackfillArgs(process.argv.slice(2));
  const guard = assertApplicationRoutePathwayBackfillApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const result = await backfillApplicationRoutePathways(
    {
      dryRun: options.dryRun,
      limit: options.limit,
    },
    {
      contactRouteModel: ContactRoute,
      researchEntityModel: ResearchEntity,
      materializeAccessForResearchGroup,
      upsertEntryPathway,
      upsertAccessSignal,
    },
  );
  const output = buildApplicationRoutePathwayBackfillOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writeApplicationRoutePathwayBackfillOutput(output, options.output);
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
