import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(true),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  materializeEntity,
  materializeFromRun,
  materializeRowOutcome,
} from '../entityMaterializer';

const RUN_ID = new mongoose.Types.ObjectId();
const SOURCE_ID = new mongoose.Types.ObjectId();
const SOURCE_NAME = 'dry-run-parity-source';
const SOURCE_URL = 'https://example.org/dry-run-parity/listing';
const OBSERVED_AT = new Date('2026-10-01T00:00:00Z');

const FELLOWSHIP_STORED_UNCHANGED = 'dry-run-parity:fellowship-alpha';
const FELLOWSHIP_STORED_STALE = 'dry-run-parity:fellowship-beta';
const FELLOWSHIP_NOT_STORED = 'dry-run-parity:fellowship-gamma';
const ENTITY_STORED_UNCHANGED = 'dry-run-parity-entity-alpha';
const ENTITY_STORED_STALE = 'dry-run-parity-entity-beta';
const ORG_UNIT_KEY = 'dry-run-parity-org-unit';

let fingerprint = 0;
const observation = (
  entityType: 'fellowship' | 'researchEntity' | 'orgUnit',
  entityKey: string,
  field: string,
  value: unknown,
) => ({
  entityType,
  entityKey,
  field,
  value,
  sourceId: SOURCE_ID,
  sourceName: SOURCE_NAME,
  sourceUrl: SOURCE_URL,
  scrapeRunId: RUN_ID,
  observedAt: OBSERVED_AT,
  confidence: 0.9,
  superseded: false,
  observationFingerprint: `parity-${(fingerprint += 1)}`,
});

const fellowshipObservations = (sourceKey: string, title: string) => [
  observation('fellowship', sourceKey, 'title', title),
  observation('fellowship', sourceKey, 'sourceKey', sourceKey),
  observation('fellowship', sourceKey, 'sourceName', SOURCE_NAME),
  observation('fellowship', sourceKey, 'sourceUrl', SOURCE_URL),
];

const researchEntityObservations = (slug: string, name: string) => [
  observation('researchEntity', slug, 'name', name),
  observation('researchEntity', slug, 'entityType', 'LAB'),
  observation('researchEntity', slug, 'kind', 'lab'),
];

const storedSnapshot = async () => ({
  fellowships: await Fellowship.find({}).sort({ sourceKey: 1 }).lean(),
  researchEntities: await ResearchEntity.find({}).sort({ slug: 1 }).lean(),
  scrapeRun: await ScrapeRun.findById(RUN_ID).lean(),
});

const countsOf = (result: Awaited<ReturnType<typeof materializeFromRun>>) => ({
  materialized: result.materialized,
  created: result.created,
  updated: result.updated,
  skipped: result.skipped,
  errors: result.errors,
});

describe('a materialize dry run classifies rows the way the apply does (#6075)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'fellowships',
      'research_entities',
      'scrape_runs',
      'role_assignments',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.create({
      _id: RUN_ID,
      sourceId: SOURCE_ID,
      sourceName: SOURCE_NAME,
      status: 'success',
    });
    await Observation.create([
      ...fellowshipObservations(FELLOWSHIP_STORED_UNCHANGED, 'Parity Travel Grant Alpha'),
      ...fellowshipObservations(FELLOWSHIP_STORED_STALE, 'Parity Travel Grant Beta'),
      ...fellowshipObservations(FELLOWSHIP_NOT_STORED, 'Parity Travel Grant Gamma'),
      ...researchEntityObservations(ENTITY_STORED_UNCHANGED, 'Parity Alpha Laboratory'),
      ...researchEntityObservations(ENTITY_STORED_STALE, 'Parity Beta Laboratory'),
      observation('orgUnit', ORG_UNIT_KEY, 'name', 'Parity Org Unit'),
    ]);
    for (const sourceKey of [FELLOWSHIP_STORED_UNCHANGED, FELLOWSHIP_STORED_STALE]) {
      await materializeEntity('fellowship', { entityKey: sourceKey });
    }
    for (const slug of [ENTITY_STORED_UNCHANGED, ENTITY_STORED_STALE]) {
      await materializeEntity('researchEntity', { entityKey: slug });
    }
    await Fellowship.updateOne(
      { sourceKey: FELLOWSHIP_STORED_STALE },
      { $set: { title: 'An Older Stored Title' } },
    );
    await ResearchEntity.updateOne(
      { slug: ENTITY_STORED_STALE },
      { $set: { name: 'An Older Stored Name' } },
    );
  });

  it('reports the apply counts on a dry run and writes nothing', async () => {
    const before = await storedSnapshot();

    const dryRun = await materializeFromRun(String(RUN_ID), { dryRun: true });

    expect(await storedSnapshot()).toEqual(before);

    const apply = await materializeFromRun(String(RUN_ID), { dryRun: false });

    expect(countsOf(apply)).toEqual({
      materialized: 6,
      created: 1,
      updated: 2,
      skipped: 3,
      errors: 0,
    });
    expect(countsOf(dryRun)).toEqual(countsOf(apply));
    expect(dryRun.changedPathsByEntityType).toEqual(apply.changedPathsByEntityType);
    expect(apply.changedPathsByEntityType?.fellowship).toContain('title');
    expect(apply.changedPathsByEntityType?.researchEntity).toContain('name');
    expect(apply.changedPathsByEntityType).not.toHaveProperty('orgUnit');
  });

  it('plans no update after the apply has run', async () => {
    await materializeFromRun(String(RUN_ID), { dryRun: false });

    const rerun = await materializeFromRun(String(RUN_ID), { dryRun: true });

    expect(countsOf(rerun)).toEqual({
      materialized: 6,
      created: 0,
      updated: 0,
      skipped: 6,
      errors: 0,
    });
    expect(rerun.changedPathsByEntityType).toEqual({});
  });

  it('classifies the dry run and the apply of an unchanged row identically', async () => {
    const outcomes = async (dryRun: boolean) => [
      materializeRowOutcome(
        await materializeEntity(
          'fellowship',
          { entityKey: FELLOWSHIP_STORED_UNCHANGED },
          { dryRun },
        ),
      ),
      materializeRowOutcome(
        await materializeEntity(
          'researchEntity',
          { entityKey: ENTITY_STORED_UNCHANGED },
          { dryRun },
        ),
      ),
      materializeRowOutcome(
        await materializeEntity('orgUnit', { entityKey: ORG_UNIT_KEY }, { dryRun }),
      ),
    ];

    expect(await outcomes(true)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(await outcomes(false)).toEqual(['skipped', 'skipped', 'skipped']);
  });
});
