/**
 * `research-search:seed-rerank-cache`: writes relevance scores produced offline into
 * `search_rerank_cache`, one entry per query key, for the serve path behind
 * `SEARCH_RERANK_CACHE_ENABLED` to reorder the top results with (#5448).
 *
 * The input is a JSON file outside the repository of `[{ query, filters, scores: { <slug>:
 * <0-3> } }]`. Slugs resolve to live research rows; an unresolved slug is counted and
 * skipped. It prints counts only, never a query or a slug.
 *
 * Dry run by default. An apply needs `--apply --confirm-search-rerank-cache-seed
 * --index-version=<marker>` and writes Development unless `--environment=beta` or
 * `--environment=production` names another target.
 *
 * Each score stores a hash of its row's searchable text, read from the target's own
 * research index when this shell's `MEILISEARCH_INDEX_PREFIX` names that environment, and a
 * dry run counts the seeded entries whose stored hashes no longer match the index.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { warmResearchSearchSpellingVocabulary } from '../services/researchSearchSpellingVocabulary';
import {
  SCRIPT_NAME,
  assertSeedSearchRerankCacheApplyAllowed,
  configuredIndexTextHashReader,
  parseSeedInput,
  parseSeedSearchRerankCacheArgs,
  resolveSeedInputPath,
  resolveSeedMongoUrl,
  seedIndexBelongsToEnvironment,
  seedSearchRerankCache,
} from './seedSearchRerankCacheCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');

async function main(): Promise<void> {
  const args = parseSeedSearchRerankCacheArgs(process.argv.slice(2));
  const inputPath = resolveSeedInputPath(args.input!, REPOSITORY_ROOT);
  const entries = parseSeedInput(JSON.parse(fs.readFileSync(inputPath, 'utf8')));

  const mongoUrl = resolveSeedMongoUrl(args.environment);
  const guard = assertScriptApplyAllowed({ apply: args.apply, scriptName: SCRIPT_NAME, mongoUrl });
  assertSeedSearchRerankCacheApplyAllowed(args, guard.dbLabel);

  await connectScriptMongo(mongoUrl);
  try {
    const indexBelongsToEnvironment = seedIndexBelongsToEnvironment(args.environment);
    // A served center's initialism keys as its title, read from the served index.
    if (indexBelongsToEnvironment) await warmResearchSearchSpellingVocabulary();
    const report = await seedSearchRerankCache({
      entries,
      apply: args.apply,
      indexVersion: args.indexVersion,
      source: args.source,
      readIndexTextHashes: indexBelongsToEnvironment
        ? configuredIndexTextHashReader
        : 'index-of-another-environment',
    });
    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          environment: args.environment,
          db: guard.dbLabel,
          indexVersion: args.indexVersion ?? null,
          ...report,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
