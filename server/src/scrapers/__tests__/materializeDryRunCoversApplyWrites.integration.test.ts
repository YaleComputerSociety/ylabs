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

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  MATERIALIZER_MANAGED_FIELDS,
  materializeEntity,
  materializeFromRun,
  materializeRowOutcome,
} from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const RUN_ID = new mongoose.Types.ObjectId();
const SOURCE_ID = new mongoose.Types.ObjectId();
const SOURCE_NAME = 'dry-run-coverage-source';
const SOURCE_URL = 'https://example.org/dry-run-coverage/listing';
const OBSERVED_AT = new Date('2026-10-01T00:00:00Z');

const USER_STALE_NETID = 'zz6075a';
const USER_SETTLED_NETID = 'zz6075b';
const USER_STALE = `netid:${USER_STALE_NETID}`;
const USER_SETTLED = `netid:${USER_SETTLED_NETID}`;
const ENTITY_STALE = 'dry-run-coverage-entity-stale';
const ENTITY_SETTLED = 'dry-run-coverage-entity-settled';
const ENTITY_NEW = 'dry-run-coverage-entity-new';

const METADATA_PATHS = new Set([
  '_id',
  '__v',
  'createdAt',
  'updatedAt',
  ...MATERIALIZER_MANAGED_FIELDS,
]);

type RowKey = { entityType: 'user' | 'researchEntity'; entityKey: string };

const ROWS: RowKey[] = [
  { entityType: 'user', entityKey: USER_STALE },
  { entityType: 'user', entityKey: USER_SETTLED },
  { entityType: 'researchEntity', entityKey: ENTITY_STALE },
  { entityType: 'researchEntity', entityKey: ENTITY_SETTLED },
  { entityType: 'researchEntity', entityKey: ENTITY_NEW },
];

let fingerprint = 0;
const observation = (
  entityType: 'user' | 'researchEntity',
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
  observationFingerprint: `coverage-${(fingerprint += 1)}`,
});

const userObservations = (entityKey: string, first: string, last: string) => [
  observation('user', entityKey, 'fname', first),
  observation('user', entityKey, 'lname', last),
  observation('user', entityKey, 'title', 'Professor of Fixture Studies'),
  observation('user', entityKey, 'primaryDepartment', 'Fixture Studies'),
  observation('user', entityKey, 'websiteUrl', `https://${last.toLowerCase()}.example.org/`),
];

const researchEntityObservations = (slug: string, name: string) => [
  observation('researchEntity', slug, 'name', name),
  observation('researchEntity', slug, 'entityType', 'LAB'),
  observation('researchEntity', slug, 'kind', 'lab'),
  observation('researchEntity', slug, 'websiteUrl', `https://${slug}.example.org/`),
];

function leafValues(value: unknown, prefix = '', out = new Map<string, string>()) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof mongoose.Types.ObjectId)
  ) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!prefix && METADATA_PATHS.has(key)) continue;
      leafValues(child, path, out);
    }
    return out;
  }
  if (value !== undefined && value !== null) out.set(prefix, JSON.stringify(value));
  return out;
}

function writtenPaths(before: unknown, after: unknown): string[] {
  const left = leafValues(before ?? {});
  const right = leafValues(after ?? {});
  const paths = new Set<string>();
  for (const path of new Set([...left.keys(), ...right.keys()])) {
    if (left.get(path) !== right.get(path)) paths.add(path);
  }
  return [...paths].sort();
}

const covers = (reported: readonly string[], written: string) =>
  reported.some(
    (path) => path === written || written.startsWith(`${path}.`) || path.startsWith(`${written}.`),
  );

async function storedRow(row: RowKey): Promise<unknown> {
  if (row.entityType === 'user') {
    const netid = row.entityKey.replace(/^netid:/, '');
    return Researcher.findOne({ 'identifiers.netid': netid }).lean();
  }
  return ResearchEntity.findOne({ slug: row.entityKey }).lean();
}

const storedRows = async () =>
  Promise.all(ROWS.map(async (row) => ({ row, doc: await storedRow(row) })));

describe('a materialize dry run reports every path its apply writes (#6075)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
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
      'researchers',
      'accounts',
      'research_entities',
      'role_assignments',
      'scrape_runs',
    ]) {
      await db.collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
    resetInvalidatedScrapeRunCache();
    resetOverSharedPersonWebsiteKeysCache();

    await ScrapeRun.create({
      _id: RUN_ID,
      sourceId: SOURCE_ID,
      sourceName: SOURCE_NAME,
      status: 'success',
    });
    for (const netid of [USER_STALE_NETID, USER_SETTLED_NETID]) {
      await Researcher.create({
        displayName: 'Fixture Person',
        identifiers: { netid },
        profile: {},
        profileLinks: [],
        status: 'UNKNOWN',
        archived: false,
      });
    }
    await Observation.create([
      ...userObservations(USER_STALE, 'Avery', 'Coverage'),
      ...userObservations(USER_SETTLED, 'Blair', 'Settled'),
      ...researchEntityObservations(ENTITY_STALE, 'Coverage Stale Laboratory'),
      ...researchEntityObservations(ENTITY_SETTLED, 'Coverage Settled Laboratory'),
      ...researchEntityObservations(ENTITY_NEW, 'Coverage New Laboratory'),
    ]);
    for (const row of ROWS.filter((candidate) => candidate.entityKey !== ENTITY_NEW)) {
      await materializeEntity(row.entityType, { entityKey: row.entityKey });
    }
    await Researcher.updateOne(
      { 'identifiers.netid': USER_STALE_NETID },
      { $set: { displayName: 'An Older Display Name' }, $unset: { 'profile.title': '' } },
    );
    await ResearchEntity.updateOne(
      { slug: ENTITY_STALE },
      { $set: { name: 'An Older Stored Name', websiteUrl: 'https://older.example.org/' } },
    );
  });

  it('covers every row and path the apply writes, measured from the stored documents', async () => {
    const dryRows = new Map<string, { outcome: string; changedPaths: string[] }>();
    for (const row of ROWS) {
      const planned = await materializeEntity(
        row.entityType,
        { entityKey: row.entityKey },
        { dryRun: true },
      );
      dryRows.set(row.entityKey, {
        outcome: materializeRowOutcome(planned),
        changedPaths: planned.changedPaths ?? [],
      });
    }
    const dryRun = await materializeFromRun(String(RUN_ID), { dryRun: true });

    const before = await storedRows();
    await materializeFromRun(String(RUN_ID), { dryRun: false });
    const after = await storedRows();

    const writtenByType = new Map<string, Set<string>>();
    const writtenRows: string[] = [];
    for (const [index, { row, doc }] of before.entries()) {
      const written = writtenPaths(doc, after[index].doc);
      if (written.length === 0) continue;
      writtenRows.push(row.entityKey);
      const planned = dryRows.get(row.entityKey);
      expect(planned?.outcome, `${row.entityKey} outcome`).not.toBe('skipped');
      for (const path of written) {
        expect(covers(planned?.changedPaths ?? [], path), `${row.entityKey} ${path}`).toBe(true);
        const typePaths = writtenByType.get(row.entityType) ?? new Set<string>();
        typePaths.add(path);
        writtenByType.set(row.entityType, typePaths);
      }
    }

    expect(writtenRows.sort()).toEqual([ENTITY_NEW, ENTITY_STALE, USER_STALE].sort());
    for (const [entityType, paths] of writtenByType) {
      const reported = dryRun.changedPathsByEntityType?.[entityType] ?? [];
      for (const path of paths) {
        expect(covers(reported, path), `${entityType} ${path}`).toBe(true);
      }
    }
  });
});
