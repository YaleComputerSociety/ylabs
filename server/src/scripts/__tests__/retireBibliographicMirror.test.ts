import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireBibliographicMirrorApplyAllowed,
  parseRetireBibliographicMirrorArgs,
  retireBibliographicMirror,
} from '../retireBibliographicMirror';
import { assertRetireBibliographicMirrorInvariants } from '../retireBibliographicMirrorCore';

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
  it('rejects a changed OFFICIAL_PROFILE link count', () => {
    expect(() =>
      assertRetireBibliographicMirrorInvariants({
        officialProfileLinksBefore: 3,
        officialProfileLinksAfter: 2,
        nonOfficialLinksAfter: 0,
      }),
    ).toThrow(/OFFICIAL_PROFILE scholarly links changed/);
  });

  it('rejects surviving non-official links', () => {
    expect(() =>
      assertRetireBibliographicMirrorInvariants({
        officialProfileLinksBefore: 3,
        officialProfileLinksAfter: 3,
        nonOfficialLinksAfter: 1,
      }),
    ).toThrow(/non-OFFICIAL_PROFILE scholarly links remain/);
  });

  it('accepts an unchanged official count with zero survivors', () => {
    expect(() =>
      assertRetireBibliographicMirrorInvariants({
        officialProfileLinksBefore: 3,
        officialProfileLinksAfter: 3,
        nonOfficialLinksAfter: 0,
      }),
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
    expect(result.before.papers).toBe(2);
    expect(result.before.officialProfileScholarlyLinks).toBe(1);
    expect(result.before.nonOfficialScholarlyLinks).toBe(2);

    await expect(db.collection('papers').countDocuments()).resolves.toBe(2);
    await expect(db.collection('paper_authors').countDocuments()).resolves.toBe(1);
    await expect(db.collection('research_scholarly_links').countDocuments()).resolves.toBe(3);
    await expect(db.collection('research_scholarly_attributions').countDocuments()).resolves.toBe(3);
    const user = await db.collection('users').findOne({ netid: 'synthetic.person' });
    expect(user?.hIndex).toBe(7);
  });

  it('retires the mirror while keeping OFFICIAL_PROFILE activity intact', async () => {
    const db = mongoose.connection.db!;
    const result = await retireBibliographicMirror({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.droppedCollections).toEqual([
      { name: 'papers', existed: true, droppedCount: 2 },
      { name: 'paper_authors', existed: true, droppedCount: 1 },
    ]);
    expect(result.deletedNonOfficialScholarlyLinks).toBe(2);
    expect(result.deletedScholarlyAttributions).toBe(2);

    await expect(db.listCollections({ name: 'papers' }).hasNext()).resolves.toBe(false);
    await expect(db.listCollections({ name: 'paper_authors' }).hasNext()).resolves.toBe(false);

    const survivingLinks = await db.collection('research_scholarly_links').find({}).toArray();
    expect(survivingLinks).toHaveLength(1);
    expect(String(survivingLinks[0]._id)).toBe(String(officialLinkId));

    const survivingAttributions = await db
      .collection('research_scholarly_attributions')
      .find({})
      .toArray();
    expect(survivingAttributions).toHaveLength(1);
    expect(String(survivingAttributions[0].scholarlyLinkId)).toBe(String(officialLinkId));

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

    expect(result.after.officialProfileScholarlyLinks).toBe(result.before.officialProfileScholarlyLinks);
    expect(result.after.nonOfficialScholarlyLinks).toBe(0);
  });
});
