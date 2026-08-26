/**
 * scrapers:audit-freshness - recency analogue of the coverage-gap backlog (#1705, migrated to #2040).
 *
 * Read-only: never mutates Source rows. Prints an impact-ranked re-crawl worklist plus a
 * fresh/due-soon/overdue/never-crawled summary, mirroring `auditProgramCatalogFreshness.ts`.
 *
 *   yarn --cwd server scrapers:audit-freshness
 *   yarn --cwd server scrapers:audit-freshness --output=./tmp/source-freshness.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Source } from '../models/source';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  SourceFreshnessInput,
  getStaleSources,
  summarizeSourceFreshness,
} from '../services/sourceFreshnessService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export interface SourceFreshnessAuditOptions {
  output?: string;
}

export function parseSourceFreshnessAuditArgs(argv: string[]): SourceFreshnessAuditOptions {
  let output: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { output };
}

async function main() {
  const options = parseSourceFreshnessAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'auditSourceFreshness',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const sources: SourceFreshnessInput[] = (await Source.find({})
    .select('name displayName enabled lastCrawledAt cadenceDays coverage.priority coverage.tier')
    .lean()) as any[];

  const now = new Date();
  const summary = summarizeSourceFreshness(sources, now);
  const worklist = getStaleSources(sources, now);

  const output = {
    mode: 'audit',
    environment: guard.environment,
    db: guard.dbLabel,
    summary,
    worklist,
  };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config();
  main()
    .catch((error) => {
      console.error('Failed to audit source freshness:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
