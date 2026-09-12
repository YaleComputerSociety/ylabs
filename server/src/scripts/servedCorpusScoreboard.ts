/**
 * Read-only served-corpus scoreboard.
 *
 * Renders a fixed baseline slug set through the real serve path against one or
 * more environments and diffs it against the stored baseline artifact, so
 * "is the served corpus getting better" is a command rather than a hand-read
 * (#2299 measured it once, by hand, on 2026-08-31; #2575 makes it repeatable).
 *
 * The slug set is fixed rather than re-sampled: a paired comparison means a
 * change in the number is a change in the corpus, not a change in the draw.
 *
 * This script only reads, and it reads with the raw MongoDB driver on purpose.
 * Importing the serve path already registers the TaxonomyTerm model, but a
 * registered model is inert until a Mongoose CONNECTION builds its indexes and
 * so recreates a collection that was deliberately dropped. Never open one here.
 *
 * Usage:
 *   yarn --cwd server research-entity:served-scoreboard \
 *     --baseline ~/ylabs-backups/handoffs/beta-served-hand-read-n100-20260831.json
 *   yarn --cwd server research-entity:served-scoreboard --baseline <path> \
 *     --environment beta --output ./tmp/served-scoreboard.json
 *
 * `--output` must land under the OS temp directory or `./tmp` (both ignored by
 * git) because the artifact carries served copy for real people.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertOperatorEnvironmentMatchesDatabase } from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertServedCorpusScoreboardConsistent,
  buildServedCorpusScoreboard,
  formatServedCorpusScoreboardReport,
  loadServedCorpusBaseline,
  parseServedCorpusScoreboardArgs,
  renderServedResearchEntity,
  SERVED_CORPUS_SCOREBOARD_SERVED_TIER,
  type ServedCorpusBaselineEntry,
  type ServedCorpusScoreboard,
  type ServedCorpusScoreboardEnvironment,
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
      `${variable} is required to read the ${environment} environment. A worktree has no server/.env of its own, so copy one in or run this from a checkout that has it.`,
    );
  }
  return value;
}

async function scoreboardForEnvironment(
  environment: ServedCorpusScoreboardEnvironment,
  baseline: ServedCorpusBaselineEntry[],
): Promise<ServedCorpusScoreboard> {
  const mongoUrl = resolveEnvironmentMongoUrl(environment);
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(environment, db.databaseName);

    const collection = db.collection(RESEARCH_ENTITIES_COLLECTION);
    const [researchEntities, studentReadyNotArchived, docs] = await Promise.all([
      collection.countDocuments({}),
      collection.countDocuments({
        studentVisibilityTier: SERVED_CORPUS_SCOREBOARD_SERVED_TIER,
        archived: { $ne: true },
      }),
      collection.find({ slug: { $in: baseline.map((entry) => entry.slug) } }).toArray(),
    ]);

    const scoreboard = buildServedCorpusScoreboard({
      environment,
      databaseName: db.databaseName,
      corpus: { researchEntities, studentReadyNotArchived },
      baseline,
      rows: docs.map((doc) => renderServedResearchEntity(doc as Record<string, any>)),
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
    scoreboards.push(await scoreboardForEnvironment(environment, baseline));
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
