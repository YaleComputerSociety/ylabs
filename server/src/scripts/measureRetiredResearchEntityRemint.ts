import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { hasRequiredFieldsForCreate, materializeEntity } from '../scrapers/entityMaterializer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const MEASURE_RETIRED_REMINT_SCRIPT_NAME = 'research-entity:measure-retired-remint';

export interface MeasureRetiredRemintOptions {
  limit?: number;
  output?: string;
}

export function parseMeasureRetiredRemintArgs(argv: string[]): MeasureRetiredRemintOptions {
  const options: MeasureRetiredRemintOptions = {};
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') {
      throw new Error(
        `${MEASURE_RETIRED_REMINT_SCRIPT_NAME} is read-only; it has no apply path. Delete rows through research-entity:cleanup-archived.`,
      );
    }
    if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error('--limit must be a positive integer');
      }
      options.limit = limit;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown ${MEASURE_RETIRED_REMINT_SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

export interface RetiredRemintVerdict {
  entityId: string;
  entityKey: string;
  archivedReason: string;
  outcome: 'would-mint' | 'would-not-mint';
  skipped?: string;
}

export interface RetiredRemintSummary {
  retiredRows: number;
  wouldMint: number;
  byReason: Record<string, { rows: number; wouldMint: number }>;
  skippedReasons: Record<string, number>;
}

export const archiveReasonClass = (archivedReason: unknown): string => {
  const reason = typeof archivedReason === 'string' ? archivedReason.trim() : '';
  if (!reason) return '(none)';
  return reason.split(/[\s(]/, 1)[0];
};

export function summarizeRetiredRemint(
  verdicts: readonly RetiredRemintVerdict[],
): RetiredRemintSummary {
  const summary: RetiredRemintSummary = {
    retiredRows: verdicts.length,
    wouldMint: 0,
    byReason: {},
    skippedReasons: {},
  };
  for (const verdict of verdicts) {
    const reason = archiveReasonClass(verdict.archivedReason);
    const bucket = (summary.byReason[reason] ??= { rows: 0, wouldMint: 0 });
    bucket.rows += 1;
    if (verdict.outcome === 'would-mint') {
      bucket.wouldMint += 1;
      summary.wouldMint += 1;
    } else if (verdict.skipped) {
      summary.skippedReasons[verdict.skipped] = (summary.skippedReasons[verdict.skipped] ?? 0) + 1;
    }
  }
  return summary;
}

// A retired row carries no `canonicalGroupId`, so nothing routes its key elsewhere, and
// the row itself is what refuses a re-mint today. Every retired row is treated as absent
// at once, so a key that would resolve onto another retired row is judged the same way.
export async function measureRetiredResearchEntityRemint(
  options: { limit?: number } = {},
): Promise<RetiredRemintVerdict[]> {
  const query = ResearchEntity.find({
    archived: true,
    $or: [{ canonicalGroupId: null }, { canonicalGroupId: { $exists: false } }],
  })
    .select('_id slug archivedReason')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const retired = (await query.lean()) as Array<{
    _id: mongoose.Types.ObjectId;
    slug?: string;
    archivedReason?: string;
  }>;
  const absent = new Set(retired.map((row) => String(row._id)));

  const verdicts: RetiredRemintVerdict[] = [];
  for (const row of retired) {
    const entityKey = typeof row.slug === 'string' ? row.slug.trim() : '';
    if (!entityKey) {
      verdicts.push({
        entityId: String(row._id),
        entityKey,
        archivedReason: row.archivedReason ?? '',
        outcome: 'would-not-mint',
        skipped: 'no-entity-key',
      });
      continue;
    }
    const result = await materializeEntity(
      'researchEntity',
      { entityKey },
      {
        dryRun: true,
        treatArchivedResearchEntitiesAsAbsent: absent,
        synthesizeCardDescription: async () => '',
      },
    );
    const skipped =
      result.skipped ??
      (result.created === true &&
      !hasRequiredFieldsForCreate('researchEntity', result.plannedSet ?? {})
        ? 'missing-required-fields'
        : undefined);
    verdicts.push({
      entityId: String(row._id),
      entityKey,
      archivedReason: row.archivedReason ?? '',
      outcome: result.created === true && !skipped ? 'would-mint' : 'would-not-mint',
      ...(skipped ? { skipped } : {}),
    });
  }
  return verdicts;
}

async function main(): Promise<void> {
  const options = parseMeasureRetiredRemintArgs(process.argv.slice(2));
  await initializeConnections();
  const verdicts = await measureRetiredResearchEntityRemint(options);
  const summary = summarizeRetiredRemint(verdicts);
  console.log(
    JSON.stringify(
      {
        script: MEASURE_RETIRED_REMINT_SCRIPT_NAME,
        db: mongoose.connection.db?.databaseName,
        ...summary,
      },
      null,
      2,
    ),
  );
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify({ summary, verdicts }, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
