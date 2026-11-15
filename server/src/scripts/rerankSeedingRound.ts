/**
 * `research-search:rerank-seeding-round`: one offline round that keeps the seeded rerank
 * cache up with what students type, with no model spend (#6222). The procedure, its
 * import rule and its privacy rules are in docs/search-rerank-cache.md ("Seeding rounds").
 *
 * `collect` reads distinct search queries since `--since`, aggregated with no user or
 * session field, from `PRODUCTION_READONLY_MONGODBURL` (refused unless the credential
 * cannot write), or from `--aggregates=<file>`. It keeps only queries the Development
 * cache does not seed and the Development route would rerank, so name queries are
 * dropped before anything is written. It prints counts only, and writes the round and
 * its scoring batch only with `--out`, outside the repository, mode 0600.
 *
 * `judge-packet` and `gate` read only files: the packet is the blind union of each
 * query's served and reranked top 10, and the gate applies the import rule and, when it
 * passes and `--seed-out` is given, writes the input for `research-search:seed-rerank-cache`.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { connectScriptMongo } from '../db/connections';
import { SearchRerankCache } from '../models/searchRerankCache';
import { searchResearchGroupsForRerankCandidates } from '../services/researchGroupService';
import { SEARCH_RERANK_WINDOW } from '../services/searchRerankCache';
import { searchRerankPromptExcerpts } from '../services/searchRerankCandidateText';
import { searchRerankCandidatesWithServedText } from '../services/searchRerankLiveMissJob';
import {
  ROUND_SCRIPT_NAME,
  ROUND_SOURCE_URL_ENV,
  type RoundArgs,
  type SearchQueryAggregate,
  type ServedCandidates,
  assertReadOnlySourcePrivileges,
  collectRoundQueries,
  gateRound,
  judgePacket,
  ndcgOutcomes,
  parseJudgeGrades,
  parseRoundArgs,
  parseRoundFile,
  scoringBatch,
  searchEventQueryAggregation,
  seedInputFromRound,
  slugScoresFromScorerOutput,
  writePrivateRoundFile,
} from './rerankSeedingRoundCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const DEVELOPMENT_DATABASE = 'Development';

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

async function readProductionQueryAggregates(since: Date): Promise<SearchQueryAggregate[]> {
  const url = process.env[ROUND_SOURCE_URL_ENV]?.trim();
  if (!url) throw new Error(`${ROUND_SOURCE_URL_ENV} is required to read search queries`);
  const client = new MongoClient(url, { readPreference: 'secondaryPreferred' });
  try {
    await client.connect();
    const database = client.db();
    assertReadOnlySourcePrivileges(
      await database.command({ connectionStatus: 1, showPrivileges: true }),
    );
    const rows = await database
      .collection('analytics_events')
      .aggregate(searchEventQueryAggregation(since), { allowDiskUse: false })
      .toArray();
    return rows.flatMap((row) =>
      typeof row.query === 'string' && typeof row.searchCount === 'number'
        ? [{ query: row.query, searchCount: row.searchCount }]
        : [],
    );
  } finally {
    await client.close();
  }
}

async function developmentServedCandidates(query: string): Promise<ServedCandidates> {
  const searched = await searchResearchGroupsForRerankCandidates(query, {}, SEARCH_RERANK_WINDOW);
  if (searched.rerankLiveMissGate !== 'eligible') {
    return { gate: searched.rerankLiveMissGate, rows: [] };
  }
  const withText = await searchRerankCandidatesWithServedText(
    searched.researchEntities.slice(0, SEARCH_RERANK_WINDOW) as Array<Record<string, unknown>>,
  );
  return {
    gate: 'eligible',
    rows: withText.map((candidate) => {
      const excerpts = searchRerankPromptExcerpts(candidate);
      return {
        slug: candidate.slug,
        name: candidate.name,
        departments: candidate.departments,
        card: excerpts.shortDescription,
        description: excerpts.fullDescription,
      };
    }),
  };
}

async function collect(args: RoundArgs): Promise<void> {
  const aggregatesFile = args.aggregates;
  const aggregates = aggregatesFile
    ? (readJson(aggregatesFile) as SearchQueryAggregate[])
    : await readProductionQueryAggregates(args.since!);

  const developmentUrl = process.env.MONGODBURL?.trim();
  if (!developmentUrl) throw new Error('MONGODBURL is required to read the Development cache');
  await connectScriptMongo(developmentUrl);
  try {
    const databaseName = mongoose.connection.db?.databaseName;
    if (databaseName !== DEVELOPMENT_DATABASE) {
      throw new Error(`${ROUND_SCRIPT_NAME} collect reads Development only (got ${databaseName})`);
    }
    const existingEntries = await SearchRerankCache.find({})
      .select('queryKey indexVersion source')
      .lean<Array<{ queryKey: string; indexVersion?: unknown; source?: unknown }>>();
    const { queries, report } = await collectRoundQueries({
      aggregates,
      existingEntries,
      searchCandidates: developmentServedCandidates,
    });
    const written = args.out
      ? {
          round: writePrivateRoundFile(
            args.out,
            { since: args.since!.toISOString(), collectedAt: new Date().toISOString(), queries },
            REPOSITORY_ROOT,
          ),
          scoringBatch: writePrivateRoundFile(
            `${args.out.replace(/\.json$/i, '')}.scoring-batch.json`,
            scoringBatch(queries),
            REPOSITORY_ROOT,
          ),
        }
      : null;
    console.log(
      JSON.stringify(
        {
          script: ROUND_SCRIPT_NAME,
          command: 'collect',
          source: aggregatesFile ? 'aggregates-file' : ROUND_SOURCE_URL_ENV,
          since: args.since!.toISOString(),
          dryRun: written === null,
          ...report,
          wroteFiles: written !== null,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

function judge(args: RoundArgs): void {
  const queries = parseRoundFile(readJson(args.round!));
  const scores = slugScoresFromScorerOutput(queries, args.scores.map(readJson));
  const pairs = judgePacket(queries, scores);
  if (args.out) writePrivateRoundFile(args.out, pairs, REPOSITORY_ROOT);
  console.log(
    JSON.stringify(
      {
        script: ROUND_SCRIPT_NAME,
        command: 'judge-packet',
        queries: scores.size,
        pairs: pairs.length,
        wroteFiles: Boolean(args.out),
      },
      null,
      2,
    ),
  );
}

function gate(args: RoundArgs): void {
  const queries = parseRoundFile(readJson(args.round!));
  const scores = slugScoresFromScorerOutput(queries, args.scores.map(readJson));
  const grades = parseJudgeGrades(args.grades.map(readJson));
  const report = gateRound(ndcgOutcomes(queries, scores, grades));
  const writesSeed = report.verdict === 'import' && Boolean(args.seedOut);
  if (writesSeed) {
    writePrivateRoundFile(args.seedOut!, seedInputFromRound(queries, scores), REPOSITORY_ROOT);
  }
  console.log(
    JSON.stringify(
      { script: ROUND_SCRIPT_NAME, command: 'gate', ...report, wroteSeed: writesSeed },
      null,
      2,
    ),
  );
  if (report.verdict !== 'import') process.exitCode = 2;
}

async function main(): Promise<void> {
  const args = parseRoundArgs(process.argv.slice(2));
  if (args.command === 'collect') await collect(args);
  else if (args.command === 'judge-packet') judge(args);
  else gate(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
