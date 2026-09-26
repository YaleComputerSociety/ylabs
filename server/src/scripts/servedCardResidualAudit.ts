/**
 * Read-only sizing run for the residual copy classes the 2026-08-31 hand-read of
 * 100 `student_ready` cards left behind (#2299).
 *
 * Every tier-admitted row is walked through `getResearchGroupDetail`, so the copy
 * judged is the copy the detail route serves. Reconstructing the projection is
 * what made three earlier measurements wrong (#2591): the route resolves the
 * roster, derives `leadMemberNames`, and only then builds the representation the
 * DTO is built from, and the representation's sanitizer passes run nowhere else.
 *
 * One route call per row, thousands of them. The calls are independent reads, so
 * they run in bounded parallel lanes (`--concurrency`, default 8), which is what
 * makes a before-and-after pair affordable rather than an hour-and-a-half each way.
 * It writes nothing to any environment.
 *
 * Connecting Mongoose builds indexes for every registered model, which recreates
 * a collection that was deliberately dropped (#2812), so `autoIndex` is disabled
 * and the collection set is compared before and after.
 *
 * Usage:
 *   yarn --cwd server research-entity:audit-served-card-residuals \
 *     --rows ./tmp/served-card-rows.json --output ./tmp/served-card-residuals.json
 *
 * `--rows` caches the served copy the walk produced, and `--from-rows` recounts
 * from that cache without touching the database. Sharpening a detector is what
 * this instrument is for, and re-walking the corpus for every predicate change
 * costs half an hour each time. Both paths carry served copy about real people, so
 * both go through the report-path guard.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { mapWithConcurrency, resolveSourceConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  collectionSetChangedMessage,
  collectionSetDelta,
  type CollectionSetDelta,
} from './servedCorpusScoreboardCore';
import {
  assertServedCardResidualAuditConsistent,
  buildServedCardResidualAudit,
  formatServedCardResidualAudit,
  type ServedCardResidualRow,
} from './servedCardResidualAuditCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEARCH_ENTITIES_COLLECTION = 'research_entities';
const SERVED_TIER = 'student_ready';

const collectionNames = async (client: MongoClient): Promise<string[]> =>
  (await client.db().listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .sort();

const textValue = (value: unknown): string => (typeof value === 'string' ? value : '');

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry)) : [];

function parseFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} needs a path`);
  return value;
}

const DEFAULT_WALK_CONCURRENCY = 8;

/**
 * The collection-set guard reports rather than aborts, and the row cache is written
 * before it runs.
 *
 * A completed walk is tens of minutes of route calls, and the guard fires on a
 * condition this command does not control: any other process that connects with
 * Mongoose and leaves `autoIndex` at its default recreates a retired collection
 * mid-walk. Throwing ahead of the cache write discarded the whole walk, and because
 * nothing at all was reported a reader could not tell the refusal from an empty
 * corpus, which is the fake-zero shape a measurement must never take (#3147).
 *
 * The figures were never invalid. The guard detects an unintended WRITE, not a bad
 * read, and a recreated empty collection does not change which rows the route served.
 * So the delta is carried on the report with the collection names that moved, the
 * figures are printed flagged rather than withheld, and the exit code is non-zero so
 * the run cannot be read as a success.
 */
function reportAudit(
  rows: ServedCardResidualRow[],
  servesNoPage: number,
  delta: CollectionSetDelta,
  safeOutput?: string,
): void {
  const audit = buildServedCardResidualAudit(rows);
  assertServedCardResidualAuditConsistent(audit);
  console.log(`\n${formatServedCardResidualAudit(audit)}`);
  console.log(`serves no page              | ${servesNoPage}`);
  console.log(`collection set changed      | ${delta.changed ? 'YES' : 'no'}`);
  if (safeOutput) {
    fs.writeFileSync(
      safeOutput,
      JSON.stringify({ ...audit, servesNoPage, collectionSet: delta }, null, 2),
    );
    console.log(`\nSlug lists and matched examples written to ${safeOutput}`);
  }
  if (delta.changed) {
    console.error(`\n${collectionSetChangedMessage('the audited database', delta)}`);
    console.error(
      'The walk above is complete and cached; recount it with --from-rows. Exiting non-zero so this is not read as a clean run.',
    );
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const requestedOutput = parseFlag(argv, '--output');
  const safeOutput = requestedOutput ? resolveSafeJsonReportOutputPath(requestedOutput) : undefined;
  const requestedRows = parseFlag(argv, '--rows');
  const safeRows = requestedRows ? resolveSafeJsonReportOutputPath(requestedRows) : undefined;
  const fromRows = parseFlag(argv, '--from-rows');
  const concurrency = resolveSourceConcurrency(
    argv.includes('--concurrency') ? Number(parseFlag(argv, '--concurrency')) : undefined,
    DEFAULT_WALK_CONCURRENCY,
  );

  if (fromRows) {
    const cached = JSON.parse(fs.readFileSync(resolveSafeJsonReportOutputPath(fromRows), 'utf8'));
    console.log(`Recounting ${cached.rows.length} cached served rows walked at ${cached.walkedAt}`);
    reportAudit(
      cached.rows as ServedCardResidualRow[],
      Number(cached.servesNoPage || 0),
      { changed: false, added: [], removed: [] },
      safeOutput,
    );
    return;
  }

  const url = String(process.env.MONGODBURL || '').trim();
  if (!url) {
    throw new Error(
      'MONGODBURL is required. A worktree has no server/.env of its own, so copy or symlink one in.',
    );
  }
  console.log(`Reading ${summarizeMongoUrl(url)}`);

  const client = new MongoClient(url);
  await client.connect();
  try {
    const db = client.db();
    const collectionsBefore = await collectionNames(client);
    const slugs = (
      await db
        .collection(RESEARCH_ENTITIES_COLLECTION)
        .find(
          { studentVisibilityTier: SERVED_TIER, archived: { $ne: true } },
          { projection: { slug: 1 } },
        )
        .toArray()
    ).map((doc) => String((doc as any).slug || ''));
    console.log(`tier-admitted rows: ${slugs.length}`);

    mongoose.set('autoIndex', false);
    await mongoose.connect(url);
    const walked = new Array<ServedCardResidualRow | null>(slugs.length).fill(null);
    let servesNoPage = 0;
    try {
      let scanned = 0;
      await mapWithConcurrency(slugs, concurrency, async (slug, index) => {
        const entity = (await getResearchGroupDetail(slug))?.researchEntity as
          | Record<string, unknown>
          | undefined
          | null;
        if (!entity) {
          servesNoPage += 1;
        } else {
          walked[index] = {
            slug,
            shortDescription: textValue(entity.shortDescription),
            fullDescription: textValue(entity.fullDescription),
            researchAreas: stringList(entity.researchAreas),
          };
        }
        scanned += 1;
        if (scanned % 250 === 0) {
          console.log(`  ${scanned}/${slugs.length} scanned`);
        }
      });
    } finally {
      await mongoose.disconnect();
    }
    // Slug order, not completion order: the report prints the first eight examples of
    // each class, so a lane finishing early would otherwise change which rows are shown.
    const rows = walked.filter((row): row is ServedCardResidualRow => row !== null);

    // Before the collection-set read, so a completed walk survives a guard refusal.
    if (safeRows) {
      fs.writeFileSync(
        safeRows,
        JSON.stringify({ walkedAt: new Date().toISOString(), servesNoPage, rows }, null, 1),
      );
      console.log(`Served copy cached at ${safeRows}`);
    }

    const delta = collectionSetDelta(collectionsBefore, await collectionNames(client));
    reportAudit(rows, servesNoPage, delta, safeOutput);
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
