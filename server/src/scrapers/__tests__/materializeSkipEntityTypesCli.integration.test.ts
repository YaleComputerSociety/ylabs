import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../cli';

const FIXTURE_SOURCE = 'fixture-skip-entity-types';
const DATABASE_NAME = 'scrape_skip_entity_types_test';
const ROW_SLUG = 'fixture-skip-entity-types-center';

describe(
  'scrape materialize --skip-entity-types leaves the skipped rows unwritten end to end (#5890)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let mongoUrl: string;
    let runId: ObjectId;
    const originalArgv = process.argv;

    const db = () => client.db(DATABASE_NAME);
    const storedRow = () => db().collection('research_entities').findOne({ slug: ROW_SLUG });

    const materialize = (...extraArgs: string[]) => {
      process.argv = [
        'node',
        'src/scrapers/cli.ts',
        'materialize',
        '--run',
        String(runId),
        '--apply',
        '--confirm-materialize',
        ...extraArgs,
      ];
      return main();
    };

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      mongoUrl = replSet.getUri(DATABASE_NAME);
      client = await MongoClient.connect(replSet.getUri());
    });

    afterAll(async () => {
      await client?.close();
      await replSet?.stop();
    });

    beforeEach(async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubEnv('MONGODBURL', mongoUrl);
      vi.stubEnv('SCRAPER_ENV', 'development');
      vi.stubEnv('SCRAPER_DEVELOPMENT_DB_NAME', DATABASE_NAME);
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', 'true');
      vi.stubEnv('DIRECTORY_REMOVAL_KEY', 'synthetic-skip-types-key-0123456789');
      for (const collection of await db().collections()) await collection.deleteMany({});

      const sourceId = new ObjectId();
      runId = new ObjectId();
      const observedAt = new Date('2026-01-01T00:00:00Z');
      await db().collection('sources').insertOne({
        _id: sourceId,
        name: FIXTURE_SOURCE,
        displayName: 'Fixture skip entity types',
        defaultWeight: 0.8,
        enabled: true,
      });
      await db().collection('scrape_runs').insertOne({
        _id: runId,
        sourceId,
        sourceName: FIXTURE_SOURCE,
        status: 'success',
        triggeredBy: 'cli',
        startedAt: observedAt,
      });
      await db().collection('research_entities').insertOne({
        slug: ROW_SLUG,
        name: 'Fixture Center',
        kind: 'center',
        archived: false,
      });
      await db().collection('observations').insertOne({
        entityType: 'researchEntity',
        entityKey: ROW_SLUG,
        field: 'name',
        value: 'Fixture Center Renamed',
        sourceId,
        sourceName: FIXTURE_SOURCE,
        scrapeRunId: runId,
        confidence: 0.9,
        observedAt,
        superseded: false,
      });
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exitCode = undefined;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('writes nothing on an observed research row the run skips, the visibility gate included', async () => {
      const before = await storedRow();

      await materialize('--skip-entity-types', 'researchEntity');

      expect(await storedRow()).toEqual(before);
    });

    it('still gates the observed research row when a different type is skipped', async () => {
      await materialize('--skip-entity-types', 'fellowship');

      expect((await storedRow())?.studentVisibilityEvaluatedAt).toBeInstanceOf(Date);
    });
  },
);
