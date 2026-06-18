/**
 * Reap zombie ScrapeRun rows left in status:running with no finishedAt.
 *
 * Aborted/overlapping scraper invocations can leave runs marked 'running' forever. They never
 * become the latest run for an actively-scraped source, but they pollute source-health (a stale
 * 'running' that becomes latest trips a warn) and run history. This marks them 'failure' with a
 * note and a finishedAt so they stop dangling.
 *
 * Default scope: --source <name> (required) plus --older-than-hours <n> (default 2) so we never
 * touch a genuinely in-flight run. Dry-run by default; apply requires
 * --apply --limit=N --confirm-v4-migration.
 *
 * Run from data-migration/:  npx tsx ReapZombieScrapeRuns.ts --source lab-microsite-description-llm [flags]
 */
import mongoose from '../server/node_modules/mongoose';
import { ScrapeRun } from '../server/src/models/scrapeRun';
import {
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';
import fs from 'fs';

const TITLE = 'Reap zombie scrape runs';

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return undefined;
}

function stripCustomFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source' || a === '--older-than-hours') {
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1; // skip its value
      continue;
    }
    if (a.startsWith('--source=') || a.startsWith('--older-than-hours=')) continue;
    out.push(a);
  }
  return out;
}

async function run(): Promise<void> {
  const options = parseMigrationOptions(stripCustomFlags(process.argv.slice(2)));
  const sourceName = argValue('--source');
  const olderThanHours = Number(argValue('--older-than-hours') ?? '2');
  if (!sourceName) throw new Error('--source <name> is required');
  if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
    throw new Error('--older-than-hours must be a non-negative number');
  }

  await connectForMigration(`${TITLE} (${sourceName}, older than ${olderThanHours}h)`, options);

  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const filter = {
    sourceName,
    status: 'running',
    startedAt: { $lt: cutoff },
    $or: [{ finishedAt: { $exists: false } }, { finishedAt: null }],
  };

  const candidates = await ScrapeRun.find(filter)
    .select('sourceName status startedAt finishedAt')
    .sort({ startedAt: -1 })
    .lean();

  const limit = Number.isFinite(options.limit) ? (options.limit as number) : candidates.length;
  const targets = candidates.slice(0, limit);

  let reaped = 0;
  if (options.apply && targets.length > 0) {
    const res = await ScrapeRun.updateMany(
      { _id: { $in: targets.map((t) => t._id) } },
      {
        $set: { status: 'failure', finishedAt: new Date() },
        $push: {
          errors: {
            message: 'Reaped stale zombie run (status:running with no completion) by maintenance.',
            at: new Date(),
          },
        },
      },
    );
    reaped = res.modifiedCount || 0;
  }

  const result = {
    sourceName,
    olderThanHours,
    cutoff: cutoff.toISOString(),
    candidates: candidates.length,
    targeted: targets.length,
    reaped,
    samples: targets.map((t) => ({
      id: String(t._id),
      startedAt: t.startedAt ? new Date(t.startedAt as Date).toISOString() : undefined,
    })),
  };

  const output = buildV4MigrationOutput(result, { db: mongoose.connection.name, options });
  console.log(JSON.stringify(output, null, 2));
  if (options.output) fs.writeFileSync(options.output, JSON.stringify(output, null, 2));

  await disconnectForMigration();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectForMigration().catch(() => undefined);
  process.exit(1);
});
