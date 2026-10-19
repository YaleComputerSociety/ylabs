import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archivedResearchEntityIds,
  carryDevelopmentArchive,
  mergedFromBySurvivorAtCopyTime,
  withLiveResearchRowsOnly,
  withMergedFromAtCopyTime,
  type DevelopmentArchiveCarryReport,
} from '../archivedTombstoneMirror';
import {
  applySync,
  buildPlan,
  collectionsForOptions,
  syncCountMismatches,
} from '../syncBetaToDevelopment';

const liveId = new ObjectId('68e0000000000000000000a1');
const liveTwoId = new ObjectId('68e0000000000000000000a2');
const mergedId = new ObjectId('68e0000000000000000000b1');
const retiredId = new ObjectId('68e0000000000000000000b2');
const archivedSinceId = new ObjectId('68e0000000000000000000b3');
const revivedId = new ObjectId('68e0000000000000000000b4');
const orgUnitId = new ObjectId('68e0000000000000000000c1');

const heavyArchived = (id: ObjectId, slug: string, canonicalGroupId?: ObjectId) => ({
  _id: id,
  slug,
  name: `Synthetic ${slug}`,
  archived: true,
  archivedReason: 'synthetic-archive',
  archivedAt: new Date('2026-09-01T00:00:00Z'),
  ...(canonicalGroupId ? { canonicalGroupId } : {}),
  fullDescription: 'A long archived description that serving environments never read.',
  researchAreas: ['Synthetic Topic'],
  schemaVersion: 2,
});

async function seedDevelopment(db: Db): Promise<void> {
  await db.collection('research_entities').insertMany([
    {
      _id: liveId,
      slug: 'live-lab',
      name: 'Live Lab',
      archived: false,
      fullDescription: 'Live.',
    },
    {
      _id: liveTwoId,
      slug: 'live-two',
      name: 'Live Two',
      archived: false,
      mergedFrom: [{ slug: 'stale-entry', entityId: new ObjectId() }],
    },
    heavyArchived(mergedId, 'merged-lab', liveId),
    heavyArchived(retiredId, 'retired-lab'),
  ]);
  await db.collection('signals').insertMany([
    { _id: new ObjectId(), researchEntityId: liveId, orgUnitId: null, type: 'A' },
    { _id: new ObjectId(), researchEntityId: mergedId, orgUnitId: null, type: 'B' },
    { _id: new ObjectId(), orgUnitId, type: 'C' },
  ]);
  await db.collection('role_assignments').insertMany([
    { _id: new ObjectId(), target: { kind: 'RESEARCH_ENTITY', id: liveId } },
    { _id: new ObjectId(), target: { kind: 'RESEARCH_ENTITY', id: retiredId } },
    { _id: new ObjectId(), target: { kind: 'ORG_UNIT', id: orgUnitId } },
  ]);
  await db.collection('research_entity_relationships').insertMany([
    { _id: new ObjectId(), sourceResearchEntityId: liveId, targetResearchEntityId: liveTwoId },
    { _id: new ObjectId(), sourceResearchEntityId: liveTwoId, targetResearchEntityId: mergedId },
  ]);
}

const corpusCollections = () => collectionsForOptions({ includeObservations: false });

async function syncDevelopmentToBeta(development: Db, beta: Db): Promise<void> {
  const collections = withLiveResearchRowsOnly(
    corpusCollections(),
    await archivedResearchEntityIds(development),
    await mergedFromBySurvivorAtCopyTime(development),
  );
  await applySync(development, beta, collections, [], async () => {
    expect(syncCountMismatches(await buildPlan(development, beta, collections))).toEqual([]);
  });
}

async function syncBetaToDevelopment(
  beta: Db,
  development: Db,
): Promise<DevelopmentArchiveCarryReport | undefined> {
  const collections = corpusCollections();
  let carry: DevelopmentArchiveCarryReport | undefined;
  await applySync(
    beta,
    development,
    collections,
    [],
    async () => {
      expect(syncCountMismatches(await buildPlan(beta, development, collections), carry)).toEqual(
        [],
      );
    },
    async (backups) => {
      carry = await carryDevelopmentArchive(development, backups);
    },
  );
  return carry;
}

describe('mergedFrom at copy time (#5148)', () => {
  it('replaces a stored list with the derived one and drops a list the tombstones no longer back', () => {
    const entry = { slug: 'merged-lab', entityId: mergedId };
    const transform = withMergedFromAtCopyTime(new Map([[String(liveId), [entry]]]));
    expect(
      transform({
        _id: liveId,
        slug: 'live-lab',
        mergedFrom: [{ slug: 'stale', entityId: retiredId }],
      }),
    ).toEqual({ _id: liveId, slug: 'live-lab', mergedFrom: [entry] });
    expect(
      transform({
        _id: liveTwoId,
        slug: 'live-two',
        mergedFrom: [{ slug: 'stale', entityId: retiredId }],
      }),
    ).toEqual({ _id: liveTwoId, slug: 'live-two' });
  });
});

describe('Development, Beta and back with live rows only', () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let development: Db;
  let beta: Db;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    development = client.db('Development_tombstone_test');
    beta = client.db('Beta_tombstone_test');
    await seedDevelopment(development);
    await syncDevelopmentToBeta(development, beta);
  });

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  });

  it('copies only live entities to Beta, each survivor carrying its merged identities', async () => {
    expect(await beta.collection('research_entities').countDocuments({ archived: true })).toBe(0);
    expect(await beta.collection('research_entities').countDocuments({})).toBe(2);
    const live = await beta.collection('research_entities').findOne({ _id: liveId });
    expect(live).toMatchObject({ fullDescription: 'Live.' });
    expect(live?.mergedFrom).toEqual([
      expect.objectContaining({ slug: 'merged-lab', entityId: mergedId }),
    ]);
    const liveTwo = await beta.collection('research_entities').findOne({ _id: liveTwoId });
    expect(liveTwo?.mergedFrom).toBeUndefined();
  });

  it('keeps the rows that hang off archived entities in Development', async () => {
    expect(await beta.collection('signals').countDocuments({ researchEntityId: mergedId })).toBe(0);
    expect(await beta.collection('signals').countDocuments({})).toBe(2);
    expect(
      await beta.collection('role_assignments').countDocuments({ 'target.id': retiredId }),
    ).toBe(0);
    expect(await beta.collection('role_assignments').countDocuments({})).toBe(2);
    expect(await beta.collection('research_entity_relationships').countDocuments({})).toBe(1);
  });

  it("restores Development's full archive when Beta is copied back", async () => {
    await development
      .collection('research_entities')
      .insertMany([
        heavyArchived(archivedSinceId, 'archived-since'),
        heavyArchived(revivedId, 'revived-lab'),
      ]);
    await beta
      .collection('research_entities')
      .insertOne({ _id: revivedId, slug: 'revived-lab', name: 'Revived Lab', archived: false });

    const carry = await syncBetaToDevelopment(beta, development);

    const merged = await development.collection('research_entities').findOne({ _id: mergedId });
    expect(merged).toMatchObject({
      fullDescription: 'A long archived description that serving environments never read.',
      canonicalGroupId: liveId,
    });
    expect(
      await development.collection('research_entities').findOne({ _id: archivedSinceId }),
    ).toMatchObject({ researchAreas: ['Synthetic Topic'] });
    expect(
      await development.collection('research_entities').findOne({ _id: revivedId }),
    ).toMatchObject({ archived: false, name: 'Revived Lab' });
    expect(
      await development.collection('signals').countDocuments({ researchEntityId: mergedId }),
    ).toBe(1);
    expect(
      await development.collection('role_assignments').countDocuments({ 'target.id': retiredId }),
    ).toBe(1);
    expect(await development.collection('research_entity_relationships').countDocuments({})).toBe(
      2,
    );
    expect(carry).toEqual({
      archivedRowsRestored: 0,
      archivedRowsInserted: 3,
      archivedRowsLiveInSource: 1,
      dependentRowsInserted: {
        signals: 1,
        role_assignments: 1,
        research_entity_relationships: 1,
      },
    });
  });
});
