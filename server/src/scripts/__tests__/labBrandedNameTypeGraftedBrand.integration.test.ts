import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
  isSyncableEntityType: () => false,
}));

import { runLabBrandedNameTypeBackfill } from '../labBrandedNameTypeBackfill';

const MICROSITE = 'https://a-researcher-lab.example.edu/';
const DIRECTORY_PROFILE = 'https://environment.example.edu/directory/faculty/b-researcher';
const BRAND_SOURCE = 'lab-microsite-description-llm';
const ROSTER_SOURCE = 'example-faculty-directory';

const researchEntities = () => mongoose.connection.db!.collection('research_entities');
const observations = () => mongoose.connection.db!.collection('observations');

const sourceId = new mongoose.Types.ObjectId();

const entityDoc = (overrides: Record<string, unknown>) => ({
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  archived: false,
  studentVisibilityTier: 'student_ready',
  manuallyLockedFields: [],
  ...overrides,
});

const observationDoc = (overrides: Record<string, unknown>) => ({
  entityType: 'researchEntity',
  sourceId,
  superseded: false,
  observedAt: new Date('2026-08-22T04:00:00.000Z'),
  ...overrides,
});

/**
 * Both rows carry a brand whose observation is keyed to a merged-away shell and
 * anchored by `entityId` to the live row, which is the state a dedupe leaves behind
 * and the state the old `entityKey`-only read could not see (#2446).
 */
const seed = async (): Promise<{ selfDeclared: string; directoryBranded: string }> => {
  const selfDeclared = new mongoose.Types.ObjectId();
  const directoryBranded = new mongoose.Types.ObjectId();
  await researchEntities().insertMany([
    entityDoc({
      _id: selfDeclared,
      slug: 'dept-example-a-researcher',
      name: 'A Researcher Lab',
      displayName: 'A Researcher Lab',
      websiteUrl: MICROSITE,
    }),
    entityDoc({
      _id: directoryBranded,
      slug: 'dept-example-b-researcher',
      name: 'B Researcher Lab',
      displayName: 'B Researcher Lab',
      websiteUrl: '',
    }),
  ]);
  await observations().insertMany([
    observationDoc({
      entityId: selfDeclared,
      entityKey: 'a-researcher-lab-shell',
      field: 'name',
      value: 'A Researcher Lab',
      sourceName: BRAND_SOURCE,
      sourceUrl: MICROSITE,
      confidence: 0.95,
    }),
    observationDoc({
      entityId: selfDeclared,
      entityKey: 'a-researcher-lab-shell',
      field: 'displayName',
      value: 'A Researcher Lab',
      sourceName: BRAND_SOURCE,
      sourceUrl: MICROSITE,
      confidence: 0.95,
    }),
    observationDoc({
      entityId: directoryBranded,
      entityKey: 'b-researcher-grant-shell',
      field: 'name',
      value: 'B Researcher Lab',
      sourceName: BRAND_SOURCE,
      sourceUrl: DIRECTORY_PROFILE,
      confidence: 0.95,
    }),
    observationDoc({
      entityId: directoryBranded,
      entityKey: 'b-researcher-grant-shell',
      field: 'displayName',
      value: 'B Researcher Lab',
      sourceName: BRAND_SOURCE,
      sourceUrl: DIRECTORY_PROFILE,
      confidence: 0.95,
    }),
    observationDoc({
      entityId: directoryBranded,
      entityKey: 'dept-example-b-researcher',
      field: 'name',
      value: 'B Researcher Faculty Research',
      sourceName: ROSTER_SOURCE,
      sourceUrl: DIRECTORY_PROFILE,
      confidence: 0.8,
      observedAt: new Date('2026-08-28T04:00:00.000Z'),
    }),
    observationDoc({
      entityId: directoryBranded,
      entityKey: 'dept-example-b-researcher',
      field: 'entityType',
      value: 'FACULTY_RESEARCH_AREA',
      sourceName: ROSTER_SOURCE,
      sourceUrl: DIRECTORY_PROFILE,
      confidence: 0.8,
      observedAt: new Date('2026-08-28T04:00:00.000Z'),
    }),
  ]);
  return { selfDeclared: String(selfDeclared), directoryBranded: String(directoryBranded) };
};

describe('lab-branded name backfill over a brand a dedupe grafted forward (#2446)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    await researchEntities().deleteMany({});
    await observations().deleteMany({});
    await seed();
  });

  const stored = async (slug: string) => (await researchEntities().findOne({ slug })) ?? undefined;

  it('reaches the live row a brand is anchored to rather than the slug the brand is keyed to', async () => {
    const result = await runLabBrandedNameTypeBackfill({ dryRun: true });

    expect(result.brandedRows).toBe(2);
    expect(
      result.rows.map((row) => [row.slug, row.outcome]).sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      ['dept-example-a-researcher', 'plan'],
      ['dept-example-b-researcher', 'brand-not-self-declared'],
    ]);
    expect((await stored('dept-example-a-researcher'))?.entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('types the row whose brand came off its own microsite, and emits the evidence for it', async () => {
    const result = await runLabBrandedNameTypeBackfill({ dryRun: false });

    expect(result.entitiesUpdated).toBe(1);
    const typed = await stored('dept-example-a-researcher');
    expect(typed?.entityType).toBe('LAB');
    expect(typed?.kind).toBe('lab');
    expect(typed?.name).toBe('A Researcher Lab');

    const emitted = await observations()
      .find({ entityKey: 'dept-example-a-researcher', field: { $in: ['entityType', 'kind'] } })
      .toArray();
    expect(emitted.map((doc) => [doc.field, doc.value, doc.sourceName]).sort()).toEqual([
      ['entityType', 'LAB', BRAND_SOURCE],
      ['kind', 'lab', BRAND_SOURCE],
    ]);
  });

  it('retracts a brand no site declared, and the row is named by its roster again', async () => {
    const result = await runLabBrandedNameTypeBackfill({ dryRun: false });

    expect(result.brandAssertionsRetracted).toBe(2);
    expect(result.namesRematerialized).toEqual([
      { slug: 'dept-example-b-researcher', name: 'B Researcher Faculty Research' },
    ]);

    const repaired = await stored('dept-example-b-researcher');
    expect(repaired?.name).toBe('B Researcher Faculty Research');
    expect(repaired).not.toHaveProperty('displayName');
    expect(repaired?.entityType).toBe('FACULTY_RESEARCH_AREA');

    const retracted = await observations()
      .find({ sourceName: BRAND_SOURCE, entityKey: 'b-researcher-grant-shell' })
      .toArray();
    expect(retracted).toHaveLength(2);
    expect(retracted.every((doc) => doc.superseded === true)).toBe(true);
  });

  it('plans nothing on a re-run, because a retracted brand no longer loads', async () => {
    await runLabBrandedNameTypeBackfill({ dryRun: false });
    const second = await runLabBrandedNameTypeBackfill({ dryRun: false });

    expect(second.summary.plan).toBe(0);
    expect(second.summary['brand-not-self-declared']).toBe(0);
    expect(second.brandAssertionsRetracted).toBe(0);
    expect(second.summary['already-lab']).toBe(1);
  });
});
