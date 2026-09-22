/**
 * scrapers:audit-freshness - recency analogue of the coverage-gap backlog (#1705, migrated to #2040).
 *
 * Read-only: never mutates Source rows. Prints an impact-ranked re-crawl worklist plus a
 * fresh/due-soon/overdue/never-crawled summary, mirroring `auditProgramCatalogFreshness.ts`.
 *
 * The worklist covers only sweep-registered sources, because a source the orchestrator does
 * not name cannot be crawled by the sweep or the CLI and so is not pending work (#2619).
 * Script-driven and retired rows are reported separately, and a row that no dispatch path
 * owns fails the audit rather than joining the worklist.
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
import { buildOrchestrator } from '../scrapers/registry';
import {
  findRegisteredScrapersWithoutSourceRow,
  partitionSourcesByDispatch,
  scriptDrivenSourceOwner,
} from '../scrapers/sourceDispatch';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  SourceFreshnessEntry,
  SourceFreshnessInput,
  SourceFreshnessSummary,
  getStaleSources,
  summarizeSourceFreshness,
} from '../services/sourceFreshnessService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export interface SourceFreshnessAuditOptions {
  output?: string;
}

export interface UndispatchedSourceEntry {
  name: string;
  displayName: string;
  lastCrawledAt: Date | null;
  runWith?: string;
}

export interface SourceFreshnessAuditReport {
  dispatch: { sweepRegistered: number; scriptDriven: number; retired: number; unowned: number };
  summary: SourceFreshnessSummary;
  worklist: SourceFreshnessEntry[];
  notDispatchedBySweep: {
    scriptDriven: UndispatchedSourceEntry[];
    retired: UndispatchedSourceEntry[];
  };
  blocking: {
    registeredScrapersWithoutSourceRow: string[];
    unownedSourceRows: string[];
    retiredSourceRowsStillEnabled: string[];
  };
}

function describeUndispatched(source: SourceFreshnessInput): UndispatchedSourceEntry {
  const runWith = scriptDrivenSourceOwner(source.name);
  return {
    name: source.name,
    displayName: source.displayName || source.name,
    lastCrawledAt: source.lastCrawledAt ?? null,
    ...(runWith ? { runWith } : {}),
  };
}

/**
 * Builds the audit report. `registeredScraperNames` must come from `buildOrchestrator()`,
 * the same resolution the sweep and the CLI use, so the worklist cannot name a source that
 * would fail with "No scraper registered with name".
 */
export function buildSourceFreshnessAuditReport(
  sources: SourceFreshnessInput[],
  registeredScraperNames: string[],
  now: Date,
): SourceFreshnessAuditReport {
  const partition = partitionSourcesByDispatch(
    sources.map((source) => source.name),
    registeredScraperNames,
  );
  const byName = new Map(sources.map((source) => [source.name, source]));
  const pick = (names: string[]) =>
    names
      .map((name) => byName.get(name))
      .filter((source): source is SourceFreshnessInput => !!source);
  const sweepRegistered = pick(partition.sweepRegistered);

  return {
    dispatch: {
      sweepRegistered: partition.sweepRegistered.length,
      scriptDriven: partition.scriptDriven.length,
      retired: partition.retired.length,
      unowned: partition.unowned.length,
    },
    summary: summarizeSourceFreshness(sweepRegistered, now),
    worklist: getStaleSources(sweepRegistered, now),
    notDispatchedBySweep: {
      scriptDriven: pick(partition.scriptDriven.slice().sort()).map(describeUndispatched),
      retired: pick(partition.retired.slice().sort()).map(describeUndispatched),
    },
    blocking: {
      registeredScrapersWithoutSourceRow: findRegisteredScrapersWithoutSourceRow(
        registeredScraperNames,
        byName.keys(),
      ),
      unownedSourceRows: partition.unowned.slice().sort(),
      retiredSourceRowsStillEnabled: pick(partition.retired)
        .filter((source) => source.enabled !== false)
        .map((source) => source.name)
        .sort(),
    },
  };
}

export function countBlockingSourceDispatchDefects(report: SourceFreshnessAuditReport): number {
  return Object.values(report.blocking).reduce((total, names) => total + names.length, 0);
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

  const registeredScraperNames = buildOrchestrator()
    .list()
    .map((scraper) => scraper.name);
  const report = buildSourceFreshnessAuditReport(sources, registeredScraperNames, new Date());

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
  if (countBlockingSourceDispatchDefects(report) > 0) {
    throw new Error(
      'Source dispatch is inconsistent. Registered scrapers missing a Source row: ' +
        `${report.blocking.registeredScrapersWithoutSourceRow.join(', ') || 'none'}. ` +
        `Source rows no dispatch path owns: ${report.blocking.unownedSourceRows.join(', ') || 'none'}. ` +
        'Retired sources whose row is still enabled: ' +
        `${report.blocking.retiredSourceRowsStillEnabled.join(', ') || 'none'}. ` +
        'Declare the lane in sourceDispatch.ts, or apply the source seed so a missing row is ' +
        'created and the retirement marker reaches a retired one.',
    );
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
