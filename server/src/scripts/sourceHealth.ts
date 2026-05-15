import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { buildSourceHealthRows } from '../services/sourceHealthService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CliOptions {
  days: number;
  includeDisabled: boolean;
  strict: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    days: 30,
    includeDisabled: false,
    strict: false,
  };

  for (const arg of argv) {
    if (arg === '--include-disabled') {
      options.includeDisabled = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--days=')) {
      const parsed = Number(arg.slice('--days='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.floor(parsed);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const sourceFilter = options.includeDisabled ? {} : { enabled: { $ne: false } };
  const sources = await Source.find(sourceFilter)
    .select('name displayName enabled cadence coverage')
    .sort({ 'coverage.priority': 1, name: 1 })
    .lean();
  const sourceNames = sources.map((source) => source.name);
  const runs = await ScrapeRun.find({
    sourceName: { $in: sourceNames },
    startedAt: { $gte: since },
  })
    .select(
      'sourceName status startedAt finishedAt observationCount materializationErrors materializationConflicts invalidated',
    )
    .sort({ sourceName: 1, startedAt: -1 })
    .lean();
  const rows = buildSourceHealthRows(sources as any[], runs as any[]);
  const riskCounts = rows.reduce(
    (counts, row) => {
      counts[row.risk] += 1;
      return counts;
    },
    { ok: 0, warn: 0, error: 0 },
  );

  const result = {
    generatedAt: new Date().toISOString(),
    windowDays: options.days,
    sources: rows.length,
    riskCounts,
    rows,
  };

  console.log(JSON.stringify(result, null, 2));
  if (options.strict && riskCounts.error > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
