import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireBibliographicMirrorApplyAllowed,
  parseRetireBibliographicMirrorArgs,
  retireBibliographicMirror,
} from '../retireBibliographicMirror';
import {
  RETIRED_COLLECTIONS,
  assertRetireBibliographicMirrorInvariants,
} from '../retireBibliographicMirrorCore';

describe('retireBibliographicMirror CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseRetireBibliographicMirrorArgs([])).toEqual({
      apply: false,
      confirmRetireBibliographicMirror: false,
    });
    expect(
      parseRetireBibliographicMirrorArgs(['--apply', '--confirm-retire-bibliographic-mirror']),
    ).toEqual({
      apply: true,
      confirmRetireBibliographicMirror: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseRetireBibliographicMirrorArgs(['prod'])).toThrow(
      /Unknown retire:bibliographic-mirror argument: prod/,
    );
    expect(() =>
      parseRetireBibliographicMirrorArgs(['--confirm-retire-bibliographic-mirror=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertRetireBibliographicMirrorApplyAllowed({
        apply: true,
        confirmRetireBibliographicMirror: false,
      }),
    ).toThrow(/--confirm-retire-bibliographic-mirror is required/);
    expect(() =>
      assertRetireBibliographicMirrorApplyAllowed({
        apply: false,
        confirmRetireBibliographicMirror: false,
      }),
    ).not.toThrow();
  });
});

describe('assertRetireBibliographicMirrorInvariants', () => {
  const allEmpty = () =>
    Object.fromEntries(RETIRED_COLLECTIONS.map((name) => [name, 0])) as Record<string, number>;

  it('rejects surviving rows in any retired collection', () => {
    expect(() =>
      assertRetireBibliographicMirrorInvariants({
        remainingByCollection: { ...allEmpty(), research_scholarly_links: 757 },
      }),
    ).toThrow(/rows remain after apply \(research_scholarly_links=757\)/);
  });

  it('names every collection that still has rows', () => {
    expect(() =>
      assertRetireBibliographicMirrorInvariants({
        remainingByCollection: {
          ...allEmpty(),
          research_scholarly_links: 757,
          research_scholarly_attributions: 23,
        },
      }),
    ).toThrow(/research_scholarly_links=757, research_scholarly_attributions=23/);
  });

  it('rejects a report that omits a retired collection instead of passing vacuously', () => {
    const partial = allEmpty();
    delete partial.research_scholarly_attributions;

    expect(() =>
      assertRetireBibliographicMirrorInvariants({ remainingByCollection: partial }),
    ).toThrow(/no post-apply count reported for research_scholarly_attributions/);
  });

  it('accepts every retired collection reporting zero', () => {
    expect(() =>
      assertRetireBibliographicMirrorInvariants({ remainingByCollection: allEmpty() }),
    ).not.toThrow();
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireBibliographicMirror with MongoDB', () => {
  const officialLinkId = new mongoose.Types.ObjectId();
  const openAlexLinkId = new mongoose.Types.ObjectId();
  const orcidLinkId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    let mongoUrl = process.env.RETIRE_MIRROR_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('retire_mirror_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;

    await db.collection('papers').insertMany([
      { _id: new mongoose.Types.ObjectId(), title: 'Synthetic Paper One' },
      { _id: new mongoose.Types.ObjectId(), title: 'Synthetic Paper Two' },
    ]);
    await db.collection('paper_authors').insertOne({
      _id: new mongoose.Types.ObjectId(),
      paperId: new mongoose.Types.ObjectId(),
    });

    await db.collection('research_scholarly_links').insertMany([
      { _id: officialLinkId, discoveredVia: 'OFFICIAL_PROFILE', title: 'Curated activity' },
      { _id: openAlexLinkId, discoveredVia: 'OPENALEX', title: 'Mirror activity' },
      { _id: orcidLinkId, discoveredVia: 'ORCID', title: 'Mirror activity two' },
    ]);

    await db.collection('research_scholarly_attributions').insertMany([
      { _id: new mongoose.Types.ObjectId(), scholarlyLinkId: officialLinkId },
      { _id: new mongoose.Types.ObjectId(), scholarlyLinkId: openAlexLinkId },
      { _id: new mongoose.Types.ObjectId(), scholarlyLinkId: orcidLinkId },
    ]);

    await db.collection('users').insertOne({
      _id: new mongoose.Types.ObjectId(),
      netid: 'synthetic.person',
      publications: [{ title: 'Synthetic Paper One' }],
      hIndex: 7,
      openAlexId: 'A9999',
      semanticScholarId: 'S9999',
      openAlexWorksSyncedAt: new Date(),
      orcidWorksSyncedAt: new Date(),
      europePmcWorksSyncedAt: new Date(),
      pubmedWorksSyncedAt: new Date(),
    });

    await db.collection('research_entities').insertOne({
      _id: new mongoose.Types.ObjectId(),
      name: 'Synthetic Home',
      recentPaperCount: 5,
      activePaperCount2yCache: 2,
      featuredPaperIds: [new mongoose.Types.ObjectId()],
      lastPaperAtCache: new Date(),
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('performs no writes in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    const result = await retireBibliographicMirror({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.before).toEqual({
      papers: 2,
      paper_authors: 1,
      research_scholarly_links: 3,
      research_scholarly_attributions: 3,
    });

    await expect(db.collection('papers').countDocuments()).resolves.toBe(2);
    await expect(db.collection('paper_authors').countDocuments()).resolves.toBe(1);
    await expect(db.collection('research_scholarly_links').countDocuments()).resolves.toBe(3);
    await expect(db.collection('research_scholarly_attributions').countDocuments()).resolves.toBe(
      3,
    );
    const user = await db.collection('users').findOne({ netid: 'synthetic.person' });
    expect(user?.hIndex).toBe(7);
  });

  it('drops the whole mirror, including OFFICIAL_PROFILE rows', async () => {
    const db = mongoose.connection.db!;
    const result = await retireBibliographicMirror({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.droppedCollections).toEqual([
      { name: 'papers', existed: true, droppedCount: 2 },
      { name: 'paper_authors', existed: true, droppedCount: 1 },
      { name: 'research_scholarly_links', existed: true, droppedCount: 3 },
      { name: 'research_scholarly_attributions', existed: true, droppedCount: 3 },
    ]);

    for (const name of RETIRED_COLLECTIONS) {
      await expect(db.listCollections({ name }).hasNext()).resolves.toBe(false);
    }

    const user = await db.collection('users').findOne({ netid: 'synthetic.person' });
    expect(user?.publications).toBeUndefined();
    expect(user?.hIndex).toBeUndefined();
    expect(user?.openAlexId).toBeUndefined();
    expect(user?.pubmedWorksSyncedAt).toBeUndefined();
    expect(user?.netid).toBe('synthetic.person');

    const entity = await db.collection('research_entities').findOne({ name: 'Synthetic Home' });
    expect(entity?.recentPaperCount).toBeUndefined();
    expect(entity?.activePaperCount2yCache).toBeUndefined();
    expect(entity?.featuredPaperIds).toBeUndefined();
    expect(entity?.lastPaperAtCache).toBeUndefined();
    expect(entity?.name).toBe('Synthetic Home');

    expect(result.after).toEqual({
      papers: 0,
      paper_authors: 0,
      research_scholarly_links: 0,
      research_scholarly_attributions: 0,
    });
  });
});
