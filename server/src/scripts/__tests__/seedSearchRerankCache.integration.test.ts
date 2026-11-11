import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { SearchRerankCache } from '../../models/searchRerankCache';
import { searchRerankCacheQueryKey } from '../../services/researchGroupService';
import { searchRerankCandidateTextHash } from '../../services/searchRerankCache';
import { assertScriptApplyAllowed } from '../scriptWriteGuards';
import {
  SEED_CONFIRM_FLAG,
  assertSeedSearchRerankCacheApplyAllowed,
  parseSeedInput,
  parseSeedSearchRerankCacheArgs,
  readIndexTextHashes,
  resolveSeedInputPath,
  resolveSeedMongoUrl,
  seedIndexBelongsToEnvironment,
  seedSearchRerankCache,
} from '../seedSearchRerankCacheCore';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

const SEED_INPUT = [
  {
    query: 'Coastal Ecology',
    filters: { departments: ['Synthetic Department'], welcomesUndergrads: true },
    scores: {
      'synthetic-coastal-lab': 3,
      'synthetic-marsh-lab': 1,
      'synthetic-missing-lab': 2,
    },
  },
  { query: 'tidal energy', scores: { 'synthetic-archived-lab': 2 } },
];

let memoryServer: MongoMemoryServer | undefined;
const entityIds: Record<string, string> = {};

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('seed_search_rerank_cache_test'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

beforeEach(async () => {
  await SearchRerankCache.collection.deleteMany({});
  await ResearchEntity.collection.deleteMany({});
  for (const [slug, archived] of [
    ['synthetic-coastal-lab', false],
    ['synthetic-marsh-lab', false],
    ['synthetic-archived-lab', true],
  ] as const) {
    const inserted = await ResearchEntity.collection.insertOne({
      slug,
      name: `Synthetic ${slug}`,
      kind: 'lab',
      archived,
    });
    entityIds[slug] = inserted.insertedId.toHexString();
  }
});

describe('research-search:seed-rerank-cache', () => {
  it('counts entries, scores and unresolved slugs on a dry run and writes nothing', async () => {
    const report = await seedSearchRerankCache({
      entries: parseSeedInput(SEED_INPUT),
      apply: false,
      source: 'test',
    });

    expect(report).toEqual({
      mode: 'dry-run',
      entries: 2,
      scores: 4,
      resolvedScores: 2,
      unresolvedSlugs: 2,
      entriesWithNoResolvedScore: 1,
      upserted: 0,
      textHashes: 'not-requested',
      scoresWithTextHash: 0,
      seededEntries: null,
      staleSeededEntries: null,
      seededEntriesWithoutTextHashes: null,
    });
    expect(await SearchRerankCache.countDocuments()).toBe(0);
  });

  it('upserts one entry per query key on apply, keyed as search keys it', async () => {
    const scoredAt = new Date('2026-11-01T00:00:00Z');
    const entries = parseSeedInput(SEED_INPUT);

    const first = await seedSearchRerankCache({
      entries,
      apply: true,
      indexVersion: 'synthetic-index-1',
      source: 'test',
      now: scoredAt,
    });
    const second = await seedSearchRerankCache({
      entries,
      apply: true,
      indexVersion: 'synthetic-index-2',
      source: 'test',
      now: scoredAt,
    });

    expect(first.upserted).toBe(2);
    expect(second.upserted).toBe(2);
    expect(await SearchRerankCache.countDocuments()).toBe(2);
    const stored = await SearchRerankCache.findOne({
      queryKey: searchRerankCacheQueryKey('coastal ecology', {
        welcomesUndergrads: true,
        departments: ['Synthetic Department'],
      }),
    }).lean();
    expect(stored).toMatchObject({
      queryText: 'Coastal Ecology',
      filters: { departments: ['Synthetic Department'], welcomesUndergrads: true },
      scores: [
        { entityId: entityIds['synthetic-coastal-lab'], score: 3 },
        { entityId: entityIds['synthetic-marsh-lab'], score: 1 },
      ],
      scoredAt,
      indexVersion: 'synthetic-index-2',
      source: 'test',
    });
  });

  describe('text hashes', () => {
    const indexDocument = (slug: string, researchAreas = ['Coastal Ecology']) => ({
      id: entityIds[slug],
      kind: 'lab',
      entityType: 'lab',
      departments: ['Synthetic Department'],
      researchAreas,
    });
    const hashesOf =
      (...documents: Array<ReturnType<typeof indexDocument>>) =>
      async () =>
        new Map(
          documents.map((document) => [document.id, searchRerankCandidateTextHash(document)]),
        );
    const coastalKey = () =>
      searchRerankCacheQueryKey('coastal ecology', {
        welcomesUndergrads: true,
        departments: ['Synthetic Department'],
      });

    it('stores the index hash of each resolved row with its score', async () => {
      const report = await seedSearchRerankCache({
        entries: parseSeedInput(SEED_INPUT),
        apply: true,
        indexVersion: 'full-synthetic-1',
        source: 'test',
        readIndexTextHashes: hashesOf(indexDocument('synthetic-coastal-lab')),
      });

      expect(report).toMatchObject({ textHashes: 'read-from-index', scoresWithTextHash: 1 });
      const stored = await SearchRerankCache.findOne({ queryKey: coastalKey() }).lean();
      expect(stored?.scores).toEqual([
        {
          entityId: entityIds['synthetic-coastal-lab'],
          score: 3,
          textHash: searchRerankCandidateTextHash(indexDocument('synthetic-coastal-lab')),
        },
        { entityId: entityIds['synthetic-marsh-lab'], score: 1 },
      ]);
    });

    it('stores no hash and says so when the index is unreachable', async () => {
      const report = await seedSearchRerankCache({
        entries: parseSeedInput(SEED_INPUT),
        apply: true,
        indexVersion: 'full-synthetic-1',
        source: 'test',
        readIndexTextHashes: async () => null,
      });

      expect(report).toMatchObject({ textHashes: 'index-unreachable', scoresWithTextHash: 0 });
      expect(report.upserted).toBe(2);
      const stored = await SearchRerankCache.findOne({ queryKey: coastalKey() }).lean();
      expect(stored?.scores.every((row: { textHash?: string | null }) => !row.textHash)).toBe(true);
    });

    it('never reads an index that belongs to another environment', async () => {
      const report = await seedSearchRerankCache({
        entries: parseSeedInput(SEED_INPUT),
        apply: false,
        source: 'test',
        readIndexTextHashes: 'index-of-another-environment',
      });

      expect(report).toMatchObject({
        textHashes: 'index-of-another-environment',
        scoresWithTextHash: 0,
        staleSeededEntries: null,
      });
    });

    it('counts stale seeded entries on a dry run, only among entries that carry hashes', async () => {
      const coastal = indexDocument('synthetic-coastal-lab');
      const scored = (textHash?: string) => [
        {
          entityId: entityIds['synthetic-coastal-lab'],
          score: 2,
          ...(textHash ? { textHash } : {}),
        },
      ];
      const scoredAt = new Date('2026-11-01T00:00:00Z');
      await SearchRerankCache.collection.insertMany([
        {
          queryKey: 'synthetic-fresh',
          queryText: 'a',
          scores: scored(searchRerankCandidateTextHash(coastal)),
          scoredAt,
          indexVersion: 'full-synthetic-0',
          source: 'test',
        },
        {
          queryKey: 'synthetic-stale',
          queryText: 'b',
          scores: scored('0000000000000000'),
          scoredAt,
          indexVersion: 'full-synthetic-0',
          source: 'test',
        },
        {
          queryKey: 'synthetic-legacy',
          queryText: 'c',
          scores: scored(),
          scoredAt,
          indexVersion: 'full-synthetic-0',
          source: 'test',
        },
        {
          queryKey: 'synthetic-live',
          queryText: 'd',
          scores: scored('0000000000000000'),
          scoredAt,
          indexVersion: 'async-gpt-5-mini-2026-11-01',
          source: 'live-miss',
        },
      ]);

      const report = await seedSearchRerankCache({
        entries: parseSeedInput(SEED_INPUT),
        apply: false,
        source: 'test',
        readIndexTextHashes: hashesOf(coastal),
      });

      expect(report).toMatchObject({
        mode: 'dry-run',
        textHashes: 'read-from-index',
        seededEntries: 3,
        staleSeededEntries: 1,
        seededEntriesWithoutTextHashes: 1,
      });
      expect(await SearchRerankCache.countDocuments()).toBe(4);
    });
  });

  it('refuses two input entries that share a query key', async () => {
    await expect(
      seedSearchRerankCache({
        entries: parseSeedInput([
          { query: 'tidal energy', scores: {} },
          { query: 'Tidal  Energy', scores: {} },
        ]),
        apply: false,
        source: 'test',
      }),
    ).rejects.toThrow('same query key');
  });
});

describe('research-search:seed-rerank-cache input', () => {
  it('refuses a score outside 0 to 3 and a missing query', () => {
    expect(() => parseSeedInput([{ query: 'x', scores: { 'synthetic-lab': 4 } }])).toThrow(
      'from 0 to 3',
    );
    expect(() => parseSeedInput([{ query: ' ', scores: {} }])).toThrow('non-empty query');
    expect(() => parseSeedInput({})).toThrow('JSON array');
  });

  it('refuses an input file inside the repository and reads one outside it', () => {
    const inside = path.join(REPOSITORY_ROOT, 'server', 'package.json');
    expect(() => resolveSeedInputPath(inside, REPOSITORY_ROOT)).toThrow('outside the repository');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rerank-seed-'));
    const outside = path.join(directory, 'scores.json');
    fs.writeFileSync(outside, '[]');
    expect(resolveSeedInputPath(outside, REPOSITORY_ROOT)).toBe(fs.realpathSync(outside));
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('research-search:seed-rerank-cache guard', () => {
  const env = {
    MONGODBURL: 'mongodb://development.invalid/Development',
    BETA_MONGODBURL: 'mongodb://beta.invalid/Beta',
    PRODUCTION_MONGODBURL: 'mongodb://production.invalid/Prod',
  } as NodeJS.ProcessEnv;
  const applyArgs = (extra: string[] = []) =>
    parseSeedSearchRerankCacheArgs([
      '--input=/tmp/scores.json',
      '--apply',
      SEED_CONFIRM_FLAG,
      '--index-version=synthetic-index-1',
      ...extra,
    ]);

  it('is a dry run against Development by default', () => {
    expect(parseSeedSearchRerankCacheArgs(['--input=/tmp/scores.json'])).toMatchObject({
      environment: 'development',
      apply: false,
      confirm: false,
    });
    expect(() => parseSeedSearchRerankCacheArgs([])).toThrow('--input');
  });

  it('needs the confirmation flag and an index version to apply', () => {
    expect(() =>
      assertSeedSearchRerankCacheApplyAllowed(
        parseSeedSearchRerankCacheArgs(['--input=/tmp/scores.json', '--apply']),
        'development.invalid/Development',
      ),
    ).toThrow(SEED_CONFIRM_FLAG);
    expect(() =>
      assertSeedSearchRerankCacheApplyAllowed(
        parseSeedSearchRerankCacheArgs(['--input=/tmp/scores.json', '--apply', SEED_CONFIRM_FLAG]),
        'development.invalid/Development',
      ),
    ).toThrow('--index-version');
    expect(() =>
      assertSeedSearchRerankCacheApplyAllowed(applyArgs(), 'development.invalid/Development'),
    ).not.toThrow();
  });

  it('refuses a non-Development database unless the environment flag names it', () => {
    expect(() => assertSeedSearchRerankCacheApplyAllowed(applyArgs(), 'beta.invalid/Beta')).toThrow(
      'restricted to a Development database',
    );
    expect(() =>
      assertSeedSearchRerankCacheApplyAllowed(
        applyArgs(['--environment=beta']),
        'beta.invalid/Beta',
      ),
    ).not.toThrow();
    expect(resolveSeedMongoUrl('beta', env)).toContain('/Beta');
    expect(resolveSeedMongoUrl('development', env)).toContain('/Development');
    expect(() => resolveSeedMongoUrl('production', {} as NodeJS.ProcessEnv)).toThrow(
      'PRODUCTION_MONGODBURL',
    );
  });

  it('leaves a Production apply to the shared guard, which wants explicit confirmation', () => {
    const mongoUrl = resolveSeedMongoUrl('production', env);
    expect(() =>
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'research-search:seed-rerank-cache',
        mongoUrl,
        env: { ...env, SCRAPER_ENV: 'production' },
      }),
    ).toThrow('CONFIRM_PROD_SCRAPE=true');
  });
});

describe('seedIndexBelongsToEnvironment', () => {
  it('reads an index only when its prefix names the target environment', () => {
    expect(seedIndexBelongsToEnvironment('development', {})).toBe(true);
    expect(seedIndexBelongsToEnvironment('beta', {})).toBe(false);
    expect(seedIndexBelongsToEnvironment('production', {})).toBe(false);
    expect(seedIndexBelongsToEnvironment('beta', { MEILISEARCH_INDEX_PREFIX: 'beta' })).toBe(true);
    expect(seedIndexBelongsToEnvironment('development', { MEILISEARCH_INDEX_PREFIX: 'beta' })).toBe(
      false,
    );
    expect(seedIndexBelongsToEnvironment('production', { MEILISEARCH_INDEX_PREFIX: 'prod' })).toBe(
      true,
    );
  });
});

describe('readIndexTextHashes', () => {
  it('pages through the index and hashes each document', async () => {
    const documents = Array.from({ length: 3 }, (_v, index) => ({
      id: `synthetic-${index}`,
      kind: 'lab',
      researchAreas: [`Synthetic Topic ${index}`],
    }));
    const getDocuments = async ({ offset }: { offset: number }) => ({
      results: documents.slice(offset, offset + 2),
      total: documents.length,
    });

    const hashes = await readIndexTextHashes({ getDocuments });

    expect(hashes?.size).toBe(3);
    expect(hashes?.get('synthetic-2')).toBe(searchRerankCandidateTextHash(documents[2]));
  });

  it('answers null when the index cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await readIndexTextHashes({
        getDocuments: async () => {
          throw new Error('synthetic outage');
        },
      }),
    ).toBeNull();
    consoleError.mockRestore();
  });
});
