import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Source } from '../models/source';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const EXPECTED_SOURCE_NAMES = [
  'ysm-atoz-index',
  'yse-centers-index',
  'yale-directory',
  'dept-faculty-roster',
  'nih-reporter',
  'nsf-award-search',
  'centers-institutes-index',
  'undergrad-fellowships-recipients',
  'lab-microsite-undergrad-llm',
] as const;

export const BETA_ROLLOUT_ORDER = [
  'ysm-atoz-index',
  'yse-centers-index',
  'centers-institutes-index',
  'dept-faculty-roster',
  'yale-directory',
  'nih-reporter',
  'nsf-award-search',
  'lab-microsite-undergrad-llm',
] as const;

export const GATED_SOURCES = ['undergrad-fellowships-recipients'] as const;

const LEGACY_COLLECTIONS = [
  'research_groups',
  'research_group_members',
  'research_group_stats',
  'paper_group_links',
  'applications',
] as const;

export interface BetaReadinessGateCliOptions {
  confirmBetaBackup: boolean;
  output?: string;
}

export function parseBetaReadinessGateArgs(argv: string[]): BetaReadinessGateCliOptions {
  const options: BetaReadinessGateCliOptions = {
    confirmBetaBackup: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--confirm-beta-backup') {
      options.confirmBetaBackup = true;
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(next);
      i++;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown Beta readiness gate argument: ${arg}`);
  }

  return options;
}

export function writeBetaReadinessGateOutput(result: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(result, null, 2)}\n`);
}

export function buildBetaReadinessGateOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: BetaReadinessGateCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: BetaReadinessGateCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function buildBetaReadinessCommands() {
  return {
    refreshFromDevelopment: 'yarn beta:refresh-from-development:plan',
    meiliRebuild: 'node scripts/reindex-search-index.mjs beta',
  };
}

function describeMongoTarget(rawUrl: string | undefined): string {
  if (!rawUrl) return 'missing MONGODBURL';
  try {
    const parsed = new URL(rawUrl);
    const database = parsed.pathname.replace(/^\//, '') || '(default database)';
    return `${parsed.hostname}/${database}`;
  } catch {
    return 'unparseable MONGODBURL';
  }
}

export const betaReadinessExitCode = (blockingGateNames: readonly string[]): number =>
  blockingGateNames.length > 0 ? 1 : 0;

async function collectionCount(name: string): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) return 0;

  const collections = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (collections.length === 0) return 0;
  return db.collection(name).estimatedDocumentCount();
}

async function main(): Promise<void> {
  const options = parseBetaReadinessGateArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'beta:readiness',
    mongoUrl: process.env.MONGODBURL,
  });
  const mongoTarget = describeMongoTarget(process.env.MONGODBURL);

  await initializeConnections();

  const sourceRows = await Source.find(
    { name: { $in: [...EXPECTED_SOURCE_NAMES] } },
    'name enabled cadence',
  ).lean();
  const presentSourceNames = new Set(sourceRows.map((source) => String(source.name)));
  const missingSources = EXPECTED_SOURCE_NAMES.filter((name) => !presentSourceNames.has(name));
  const legacyCollectionCounts = Object.fromEntries(
    await Promise.all(
      LEGACY_COLLECTIONS.map(async (name) => [name, await collectionCount(name)] as const),
    ),
  );
  const legacyResidueCount = Object.values(legacyCollectionCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const gates = {
    betaBackup: {
      status: options.confirmBetaBackup ? 'ready' : 'blocked',
      message: options.confirmBetaBackup
        ? 'Operator confirmed a Beta backup or restore point exists.'
        : 'Pass --confirm-beta-backup only after a Beta backup or restore point exists.',
    },
    canonicalMigration: {
      status: legacyResidueCount === 0 ? 'ready' : 'blocked',
      message:
        legacyResidueCount === 0
          ? 'Canonical hard migration check found no legacy source collection rows.'
          : 'Legacy source collections still contain rows; clean them up in Development and let the Development-to-Beta refresh mirror the result.',
      legacyCollectionCounts,
    },
    sourceMetadata: {
      status: missingSources.length === 0 ? 'ready' : 'blocked',
      message:
        missingSources.length === 0
          ? 'Expected scraper source metadata exists.'
          : 'Expected scraper source metadata is missing; the Development-to-Beta refresh copies the sources collection.',
      missingSources,
    },
  };

  const blockingGateNames = Object.entries(gates)
    .filter(([, gate]) => gate.status === 'blocked')
    .map(([name]) => name);

  const result = buildBetaReadinessGateOutput(
    {
      generatedAt: new Date().toISOString(),
      mongoTarget,
      ready: blockingGateNames.length === 0,
      blockingGateNames,
      gates,
      counts: {
        researchEntities: await ResearchEntity.countDocuments({ archived: { $ne: true } }),
      },
      rollout: {
        unblockedOrder: [...BETA_ROLLOUT_ORDER],
        gatedSources: [...GATED_SOURCES],
        note: 'Run sources one at a time, inspect each report, and materialize only accepted runs.',
      },
      commands: buildBetaReadinessCommands(),
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );

  console.log(JSON.stringify(result, null, 2));
  writeBetaReadinessGateOutput(result, options.output);
  process.exitCode = betaReadinessExitCode(blockingGateNames);
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
