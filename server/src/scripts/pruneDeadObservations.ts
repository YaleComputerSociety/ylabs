import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ScrapeSnapshot } from '../models/scrapeSnapshot';
import { pruneDeadObservations } from '../scrapers/observationRetention';
import { applyObservationPruneEnvironmentGuards } from '../scrapers/scraperEnvironment';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertPruneDeadObservationsApplyAllowed,
  parsePruneDeadObservationsArgs,
  type PruneDeadObservationsArgs,
} from './pruneDeadObservationsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function writeReport(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function dropSnapshotCache(apply: boolean): Promise<number> {
  if (!apply) return await ScrapeSnapshot.estimatedDocumentCount();
  const result = await ScrapeSnapshot.deleteMany({});
  return result.deletedCount || 0;
}

async function main(args: PruneDeadObservationsArgs): Promise<void> {
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'observations:prune-dead',
    mongoUrl: process.env.MONGODBURL,
  });
  const guard = applyObservationPruneEnvironmentGuards({
    apply: args.apply,
    mongoUrl: process.env.MONGODBURL,
  });
  for (const warning of guard.warnings) console.warn(`[prune-dead-observations] ${warning}`);
  const apply = guard.apply;
  assertPruneDeadObservationsApplyAllowed({ ...args, apply }, guard.dbLabel, guard.environment);

  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required for prune-dead-observations');
  await mongoose.connect(mongoUrl);

  const prune = await pruneDeadObservations({
    apply,
    ...(args.keepRuns !== undefined ? { keepRuns: args.keepRuns } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
  });
  const snapshotsAffected = args.dropSnapshotCache ? await dropSnapshotCache(apply) : undefined;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: apply ? 'apply' : 'dry-run',
    prune,
    ...(snapshotsAffected !== undefined
      ? { snapshotCache: { dropped: apply, affected: snapshotsAffected } }
      : {}),
  };
  console.log(JSON.stringify(report, null, 2));
  writeReport(report, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main(parsePruneDeadObservationsArgs(process.argv.slice(2)))
    .catch((error) => {
      console.error('Failed to prune dead observations:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
