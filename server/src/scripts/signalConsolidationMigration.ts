/**
 * One-time data migration for the Signal consolidation (#362).
 *
 * Copies every legacy `access_signals` and `undergraduate_logistics_claims`
 * document into the unified `signals` collection using the same document _id so
 * existing review references stay valid. Idempotent: re-running upserts by _id.
 * This is a HUMAN-GATED destructive-adjacent operation - dry-run by default.
 *
 * Usage:
 *   MONGODBURL="mongodb://..." tsx src/scripts/signalConsolidationMigration.ts --dry-run --output /tmp/signal-migration.json
 *   SCRAPER_ENV=beta MONGODBURL="mongodb://..." tsx src/scripts/signalConsolidationMigration.ts --apply --confirm-signal-consolidation
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { planSignalConsolidation, type SignalConsolidationPlan } from './signalConsolidationMigrationCore';

dotenv.config();

const SCRIPT_NAME = 'signal-consolidation-migration';

export interface SignalConsolidationMigrationOptions {
  apply: boolean;
  confirmSignalConsolidation?: boolean;
  output?: string;
}

export function parseSignalConsolidationMigrationArgs(
  argv: string[],
): SignalConsolidationMigrationOptions {
  const options: SignalConsolidationMigrationOptions = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-signal-consolidation') {
      options.confirmSignalConsolidation = true;
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function writeSignalsFromPlan(plan: SignalConsolidationPlan): Promise<number> {
  if (plan.signals.length === 0) return 0;
  const db = mongoose.connection.db;
  if (!db) throw new Error('No active MongoDB connection');
  const operations = plan.signals.map((signal) => ({
    updateOne: {
      filter: { _id: signal._id },
      update: { $set: signal },
      upsert: true,
    },
  }));
  const result = await db.collection('signals').bulkWrite(operations as any[], { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0);
}

export async function migrateSignalConsolidation(options: SignalConsolidationMigrationOptions) {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL environment variable is required');

  await mongoose.connect(mongoUrl);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No active MongoDB connection');
    const [accessSignals, logisticsClaims] = await Promise.all([
      db.collection('access_signals').find({}).toArray(),
      db.collection('undergraduate_logistics_claims').find({}).toArray(),
    ]);
    const plan = planSignalConsolidation(accessSignals, logisticsClaims);
    const written = options.apply ? await writeSignalsFromPlan(plan) : 0;
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      accessSignalsMapped: plan.accessSignalsMapped,
      accessSignalsSkipped: plan.accessSignalsSkipped,
      logisticsClaimsMapped: plan.logisticsClaimsMapped,
      logisticsClaimsSkipped: plan.logisticsClaimsSkipped,
      signalsToWrite: plan.signals.length,
      signalsWritten: written,
    };
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  const options = parseSignalConsolidationMigrationArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirmSignalConsolidation) {
    throw new Error('Refusing to apply without --confirm-signal-consolidation');
  }
  const report = await migrateSignalConsolidation(options);
  const output = {
    script: SCRIPT_NAME,
    environment: guard.environment,
    db: guard.dbLabel,
    ...report,
  };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch(async (err) => {
    console.error('Fatal error:', sanitizeLogValue(err));
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}
