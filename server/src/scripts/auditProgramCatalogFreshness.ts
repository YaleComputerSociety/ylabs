/**
 * programs:audit-freshness - detects the corpus-wide catalog-freshness cliff for the
 * /programs (aliased /fellowships) surface (#1299, the durable guard #555 never got).
 *
 * Read-only: never mutates catalog data. Emits machine-readable JSON and a non-zero exit
 * code when the guard trips, so it can run unattended (cron/CI) instead of relying on a
 * human dogfooding the page. Thresholds live in config
 * (`DEFAULT_CATALOG_FRESHNESS_THRESHOLDS`) and are overridable per run.
 *
 *   yarn --cwd server programs:audit-freshness
 *   yarn --cwd server programs:audit-freshness --output=./tmp/catalog-freshness.json
 *   yarn --cwd server programs:audit-freshness --min-accepting-share=0.1 --max-past-deadline-share=0.8
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  CatalogFreshnessThresholds,
  DEFAULT_CATALOG_FRESHNESS_THRESHOLDS,
  computeCatalogFreshness,
} from '../services/programCatalogFreshnessService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export const CATALOG_FRESHNESS_ALARM_EXIT_CODE = 2;

export interface CatalogFreshnessAuditOptions {
  output?: string;
  thresholds: CatalogFreshnessThresholds;
}

const parseShare = (raw: string, flag: string): number => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${flag} must be a number between 0 and 1`);
  }
  return value;
};

const parseCorpusSize = (raw: string, flag: string): number => {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return Number(raw);
};

export function parseCatalogFreshnessAuditArgs(argv: string[]): CatalogFreshnessAuditOptions {
  const thresholds: CatalogFreshnessThresholds = { ...DEFAULT_CATALOG_FRESHNESS_THRESHOLDS };
  let output: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--min-accepting-share=')) {
      thresholds.minAcceptingShare = parseShare(
        arg.slice('--min-accepting-share='.length),
        '--min-accepting-share',
      );
    } else if (arg.startsWith('--max-past-deadline-share=')) {
      thresholds.maxPastDeadlineShare = parseShare(
        arg.slice('--max-past-deadline-share='.length),
        '--max-past-deadline-share',
      );
    } else if (arg.startsWith('--min-corpus-size=')) {
      thresholds.minCorpusSize = parseCorpusSize(
        arg.slice('--min-corpus-size='.length),
        '--min-corpus-size',
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { output, thresholds };
}

async function main() {
  const options = parseCatalogFreshnessAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'auditProgramCatalogFreshness',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const records: any[] = await Fellowship.find({
    archived: false,
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('title isAcceptingApplications deadline sourceKey')
    .lean();

  const report = computeCatalogFreshness(records, new Date(), options.thresholds);

  const output = {
    mode: 'audit',
    environment: guard.environment,
    db: guard.dbLabel,
    ...report,
  };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }

  if (report.status === 'stale') {
    process.exitCode = CATALOG_FRESHNESS_ALARM_EXIT_CODE;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config();
  main()
    .catch((error) => {
      console.error('Failed to audit program catalog freshness:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
