/**
 * Read-only canonical legacy-write-surface audit (#210 Phase 6, #727).
 *
 * Dual-write verification. Statically scans runtime source for writers to the
 * retired legacy surfaces, confirms the retired Mongoose models are no longer
 * registered, and confirms the retired collections carry no data on the target
 * database. It never writes anything.
 *
 * Usage:
 *   yarn --cwd server model-refactor:legacy-writer-scan --environment development \
 *     --output /tmp/ylabs-legacy-write-surface-dev.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoClient, type Db } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertOperatorEnvironmentMatchesDatabase } from './operatorDatabaseEnvironment';
import {
  buildLegacyWriteSurfaceReport,
  parseLegacyWriteSurfaceArgs,
  RETIRED_LEGACY_COLLECTIONS,
  RETIRED_LEGACY_MODELS,
  scanLegacyWriteSurface,
  type LegacyWriteSourceFile,
  type RetiredCollectionState,
  type RetiredModelState,
} from './canonicalLegacyWriteSurfaceAuditCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import '../models';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SERVER_SRC_ROOT = path.resolve(__dirname, '..');
const EXCLUDED_DIR_SEGMENTS = new Set(['scripts', '__tests__', 'node_modules', 'dist']);

function collectRuntimeSourceFiles(): LegacyWriteSourceFile[] {
  const files: LegacyWriteSourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
      files.push({
        relPath: path.relative(SERVER_SRC_ROOT, absolute).replace(/\\/g, '/'),
        content: fs.readFileSync(absolute, 'utf8'),
      });
    }
  };
  walk(SERVER_SRC_ROOT);
  return files.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

function retiredModelStates(): RetiredModelState[] {
  return RETIRED_LEGACY_MODELS.map((modelName) => ({
    modelName,
    registered: Object.prototype.hasOwnProperty.call(mongoose.models, modelName),
  }));
}

async function retiredCollectionStates(db: Db): Promise<RetiredCollectionState[]> {
  const liveNames = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );
  const states: RetiredCollectionState[] = [];
  for (const collectionName of RETIRED_LEGACY_COLLECTIONS) {
    if (!liveNames.has(collectionName)) {
      states.push({ collectionName, exists: false, documentCount: 0 });
      continue;
    }
    states.push({
      collectionName,
      exists: true,
      documentCount: await db.collection(collectionName).countDocuments({}),
    });
  }
  return states;
}

async function main(): Promise<void> {
  const args = parseLegacyWriteSurfaceArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  if (args.output) resolveSafeJsonReportOutputPath(args.output);

  const scan = scanLegacyWriteSurface(collectRuntimeSourceFiles());
  const retiredModels = retiredModelStates();

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(args.environment, db.databaseName);

    const report = buildLegacyWriteSurfaceReport({
      environment: args.environment,
      databaseName: db.databaseName,
      scan,
      retiredCollections: await retiredCollectionStates(db),
      retiredModels,
    });

    console.log(JSON.stringify({ ...report, target: summarizeMongoUrl(mongoUrl) }, null, 2));
    if (args.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(args.output);
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await client.close();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
