/**
 * Read-only served-corpus scoreboard.
 *
 * Renders a fixed baseline slug set through the real detail route against one or
 * more environments and diffs it against the stored baseline artifact, so
 * "is the served corpus getting better" is a command rather than a hand-read
 * (#2299 measured it once, by hand, on 2026-08-31; #2575 makes it repeatable).
 *
 * The slug set is fixed rather than re-sampled: a paired comparison means a
 * change in the number is a change in the corpus, not a change in the draw.
 *
 * It calls `getResearchGroupDetail` per slug rather than reconstructing the
 * projection. Every reconstruction measured a different surface: the DTO on the
 * stored document skips the representation's sanitizer passes (373 of 7002
 * Development rows, 160 of them served), and pre-sanitizing with the narrow
 * helper still differs on 335. The route resolves the roster, derives
 * `leadMemberNames`, and only then builds the representation the DTO comes from,
 * so the only faithful way to read the served copy is to ask the route.
 *
 * That needs a Mongoose connection, which is the one thing this must not let
 * change the environment being read: connecting builds indexes for every
 * registered model and so recreates a collection that was deliberately dropped.
 * So `autoIndex` is disabled before connecting and the collection set is
 * compared before and after, failing loudly if it moved. Corpus counts come from
 * the raw driver.
 *
 * Usage:
 *   yarn --cwd server research-entity:served-scoreboard \
 *     --baseline ~/ylabs-backups/handoffs/beta-served-hand-read-n100-20260831.json
 *   yarn --cwd server research-entity:served-scoreboard --baseline <path> \
 *     --environment beta --output ./tmp/served-scoreboard.json
 *
 * `--corpus-reachability` additionally walks every tier-admitted row through the
 * route, so the reachable count is measured rather than taken from the stored
 * tier. Thousands of route calls, minutes rather than seconds, hence opt-in.
 *
 * `--output` must land under the OS temp directory or `./tmp` (both ignored by
 * git) because the artifact carries served copy for real people.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertOperatorEnvironmentMatchesDatabase } from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { getResearchGroupDetail } from '../services/researchGroupService';
import {
  assertCollectionSetUnchanged,
  assertServedCorpusScoreboardConsistent,
  buildServedCorpusScoreboard,
  formatServedCorpusScoreboardReport,
  loadServedCorpusBaseline,
  parseServedCorpusScoreboardArgs,
  renderServedResearchEntityRow,
  SERVED_CORPUS_SCOREBOARD_SERVED_TIER,
  type ServedCorpusBaselineEntry,
  type ServedCorpusScoreboard,
  type ServedCorpusScoreboardEnvironment,
  type ServedResearchEntityRow,
} from './servedCorpusScoreboardCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEARCH_ENTITIES_COLLECTION = 'research_entities';

const MONGO_URL_ENV_VARS: Record<ServedCorpusScoreboardEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export function resolveEnvironmentMongoUrl(
  environment: ServedCorpusScoreboardEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = MONGO_URL_ENV_VARS[environment];
  const value = env[variable]?.trim();
  if (!value) {
    throw new Error(
      `${variable} is required to read the ${environment} environment. A worktree has no server/.env of its own, so copy or symlink one in.`,
    );
  }
  return value;
}

const collectionNames = async (client: MongoClient): Promise<string[]> =>
  (await client.db().listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .sort();

/**
 * Every tier-admitted row through the route, so the reachable count is measured
 * rather than inferred from the stored tier. One route call per row, thousands of
 * them, which is why this is opt-in.
 */
async function corpusReachability(
  tierAdmittedSlugs: string[],
): Promise<{ reachable: number; servesNoPageSlugs: string[] }> {
  const servesNoPageSlugs: string[] = [];
  let reachable = 0;
  let scanned = 0;
  for (const slug of tierAdmittedSlugs) {
    scanned += 1;
    const detail = await getResearchGroupDetail(slug);
    if (detail) reachable += 1;
    else servesNoPageSlugs.push(slug);
    if (scanned % 250 === 0) {
      console.log(
        `  reachability: ${scanned}/${tierAdmittedSlugs.length} scanned, ${servesNoPageSlugs.length} serving no page`,
      );
    }
  }
  return { reachable, servesNoPageSlugs };
}

async function scoreboardForEnvironment(
  environment: ServedCorpusScoreboardEnvironment,
  baseline: ServedCorpusBaselineEntry[],
  options: { corpusReachability: boolean },
): Promise<ServedCorpusScoreboard> {
  const mongoUrl = resolveEnvironmentMongoUrl(environment);
  const client = new MongoClient(mongoUrl);
  await client.connect();

  try {
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(environment, db.databaseName);
    const collectionsBefore = await collectionNames(client);

    const collection = db.collection(RESEARCH_ENTITIES_COLLECTION);
    const slugs = baseline.map((entry) => entry.slug);
    const [researchEntities, studentReadyNotArchived, docs] = await Promise.all([
      collection.countDocuments({}),
      collection.countDocuments({
        studentVisibilityTier: SERVED_CORPUS_SCOREBOARD_SERVED_TIER,
        archived: { $ne: true },
      }),
      collection.find({ slug: { $in: slugs } }).toArray(),
    ]);

    const tierAdmittedSlugs = options.corpusReachability
      ? (
          await collection
            .find(
              {
                studentVisibilityTier: SERVED_CORPUS_SCOREBOARD_SERVED_TIER,
                archived: { $ne: true },
              },
              { projection: { slug: 1 } },
            )
            .toArray()
        ).map((doc) => String((doc as any).slug || ''))
      : [];

    mongoose.set('autoIndex', false);
    await mongoose.connect(mongoUrl);
    const rows: ServedResearchEntityRow[] = [];
    let reachability: { reachable: number; servesNoPageSlugs: string[] } | undefined;
    try {
      for (const doc of docs) {
        const detail = await getResearchGroupDetail(String((doc as any).slug || ''));
        rows.push(
          renderServedResearchEntityRow({
            doc: doc as Record<string, any>,
            servedEntity:
              (detail?.researchEntity as Record<string, unknown> | undefined | null) ?? null,
          }),
        );
      }
      if (options.corpusReachability) {
        console.log(`  reachability: walking ${tierAdmittedSlugs.length} tier-admitted rows`);
        reachability = await corpusReachability(tierAdmittedSlugs);
      }
    } finally {
      await mongoose.disconnect();
    }

    assertCollectionSetUnchanged(environment, collectionsBefore, await collectionNames(client));

    const scoreboard = buildServedCorpusScoreboard({
      environment,
      databaseName: db.databaseName,
      corpus: {
        researchEntities,
        studentReadyNotArchived,
        ...(reachability
          ? {
              reachable: reachability.reachable,
              servesNoPage: reachability.servesNoPageSlugs.length,
              servesNoPageSlugs: reachability.servesNoPageSlugs,
            }
          : {}),
      },
      baseline,
      rows,
    });
    assertServedCorpusScoreboardConsistent(scoreboard);
    return scoreboard;
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const options = parseServedCorpusScoreboardArgs(process.argv.slice(2));
  const baseline = loadServedCorpusBaseline(fs.readFileSync(options.baselinePath, 'utf8'));
  // Resolved before the first database read: rejecting the artifact path after
  // three Atlas reads have already run throws away the served text the run
  // exists to produce.
  const safeOutput = options.output ? resolveSafeJsonReportOutputPath(options.output) : undefined;
  for (const environment of options.environments) resolveEnvironmentMongoUrl(environment);

  const scoreboards: ServedCorpusScoreboard[] = [];
  for (const environment of options.environments) {
    console.log(
      `Reading ${environment} (${summarizeMongoUrl(resolveEnvironmentMongoUrl(environment))})`,
    );
    scoreboards.push(
      await scoreboardForEnvironment(environment, baseline, {
        corpusReachability: options.corpusReachability,
      }),
    );
  }

  console.log('');
  console.log(formatServedCorpusScoreboardReport(scoreboards, options.textLimit));

  if (safeOutput) {
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(
      safeOutput,
      `${JSON.stringify(
        {
          baselinePath: options.baselinePath,
          baselineSlugs: baseline.length,
          generatedAt: new Date().toISOString(),
          surface: 'detail route, roster-resolved (getResearchGroupDetail)',
          scoreboards,
        },
        null,
        2,
      )}\n`,
    );
    console.log('');
    console.log(`Full served text written to ${safeOutput}`);
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
