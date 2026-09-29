import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { reconcileBbsTrackRetirementsFromRun } from '../bbsTrackRosterRetirement';
import { BBS_TRACKS } from '../sources/bbsResearchTrackScraper';

let memoryReplSet: MongoMemoryReplSet | undefined;
const sourceId = new mongoose.Types.ObjectId();

/**
 * A claim written in the older identity form: `entityKey` and no `entityId`.
 *
 * Governance used to key on `entityId` alone, which reached 47% of this lane's claims and none of
 * the population #3852 was filed about: 545 of 1,037 live claims carry only an `entityKey`, and
 * those are the August grafts. Of those 545 keys only 130 name a live row, so the other 415 are
 * orphans and must be excluded rather than counted absent.
 */
const seedClaim = async (identity: { entityId?: mongoose.Types.ObjectId; entityKey?: string }) =>
  Observation.create({
    entityType: 'researchEntity',
    field: 'researchAreas',
    sourceId,
    sourceName: 'bbs-research-track',
    value: ['Immunology'],
    confidence: 0.7,
    superseded: false,
    observedAt: new Date('2026-08-27T00:00:00Z'),
    ...identity,
  });

/** One admitted read per run: complete, off the wire, listing at least one PI, for every track. */
const seedAdmittedRead = async (options: {
  runId: mongoose.Types.ObjectId;
  observedAt: Date;
  listedRowIds: string[];
}) => {
  for (const track of BBS_TRACKS) {
    await Observation.create({
      entityType: 'centerRosterHealth',
      entityKey: track.slug,
      field: 'centerRosterHealth',
      sourceId,
      sourceName: 'bbs-research-track',
      scrapeRunId: options.runId,
      observedAt: options.observedAt,
      confidence: 0.7,
      superseded: false,
      value: {
        centerKey: track.slug,
        entityKey: track.slug,
        status: 'ok',
        complete: true,
        claimEntityKeysRecorded: true,
        discoveredCount: options.listedRowIds.length,
        members: options.listedRowIds.map((rowId, index) => ({
          memberKey: `pi-${track.slug}-${index}`,
          role: 'track-pi',
          claimEntityKey: rowId,
        })),
        read: {
          pagesRead: 1,
          readMode: 'html',
          cacheAllowed: false,
          stopReason: 'not-paginated',
          readAt: options.observedAt.toISOString(),
        },
      },
    });
  }
};

describe('BBS retirement governs both identity forms', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('bbs_retirement_identity_test'));
  }, 120_000);

  afterEach(async () => {
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  const deps = { rematerializeEntityId: async () => {} };

  it('governs an entityKey-only claim on a live row and retires it only after two admitted reads', async () => {
    const row = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-one',
      name: 'Synthetic One Research',
      researchAreas: ['Immunology'],
    });
    const other = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-two',
      name: 'Synthetic Two Research',
    });
    const claim = await seedClaim({ entityKey: 'ysm-faculty-synthetic-one' });
    // Two claims the reads DO support, so retiring the third stays under the absence ceiling.
    // Without them one absent claim is 100% of the governed population and the pass freezes,
    // which is the ceiling working rather than a defect.
    const supportedA = await ResearchEntity.create({
      slug: 'ysm-faculty-supported-a',
      name: 'Supported A Research',
    });
    const supportedB = await ResearchEntity.create({
      slug: 'ysm-faculty-supported-b',
      name: 'Supported B Research',
    });
    await seedClaim({ entityId: supportedA._id as mongoose.Types.ObjectId });
    await seedClaim({ entityId: supportedB._id as mongoose.Types.ObjectId });
    const listedRowIds = [String(supportedA._id), String(supportedB._id)];
    void other;

    const runOne = new mongoose.Types.ObjectId();
    await seedAdmittedRead({
      runId: runOne,
      observedAt: new Date('2026-09-10T00:00:00Z'),
      listedRowIds,
    });
    const afterOne = await reconcileBbsTrackRetirementsFromRun(String(runOne), deps, {});
    expect(afterOne.counts?.governedClaims).toBe(3);
    expect(afterOne.counts?.retiredClaims).toBe(0);
    expect((await Observation.findById(claim._id).lean())?.superseded).not.toBe(true);

    const runTwo = new mongoose.Types.ObjectId();
    await seedAdmittedRead({
      runId: runTwo,
      observedAt: new Date('2026-09-11T00:00:00Z'),
      listedRowIds,
    });
    const afterTwo = await reconcileBbsTrackRetirementsFromRun(String(runTwo), deps, {});
    expect(afterTwo.counts?.retiredClaims).toBe(1);
    const retired = await Observation.findById(claim._id).lean();
    expect(retired?.superseded).toBe(true);
    expect(String(row.slug)).toBe('ysm-faculty-synthetic-one');
  }, 120_000);

  it('excludes a claim whose key names no live row rather than counting it absent', async () => {
    const other = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-two',
      name: 'Synthetic Two Research',
    });
    const orphan = await seedClaim({ entityKey: 'ysm-faculty-row-that-no-longer-exists' });

    const runOne = new mongoose.Types.ObjectId();
    await seedAdmittedRead({
      runId: runOne,
      observedAt: new Date('2026-09-10T00:00:00Z'),
      listedRowIds: [String(other._id)],
    });
    const runTwo = new mongoose.Types.ObjectId();
    await seedAdmittedRead({
      runId: runTwo,
      observedAt: new Date('2026-09-11T00:00:00Z'),
      listedRowIds: [String(other._id)],
    });

    const result = await reconcileBbsTrackRetirementsFromRun(String(runTwo), deps, {});
    expect(result.counts?.orphanedClaims).toBe(1);
    expect(result.counts?.governedClaims).toBe(0);
    expect((await Observation.findById(orphan._id).lean())?.superseded).not.toBe(true);
  }, 120_000);

  it('governs an entityId-keyed claim on the same footing', async () => {
    const row = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-three',
      name: 'Synthetic Three Research',
    });
    const claim = await seedClaim({ entityId: row._id as mongoose.Types.ObjectId });
    const supportedA = await ResearchEntity.create({
      slug: 'ysm-faculty-supported-a',
      name: 'Supported A Research',
    });
    const supportedB = await ResearchEntity.create({
      slug: 'ysm-faculty-supported-b',
      name: 'Supported B Research',
    });
    await seedClaim({ entityId: supportedA._id as mongoose.Types.ObjectId });
    await seedClaim({ entityId: supportedB._id as mongoose.Types.ObjectId });
    const listedRowIds = [String(supportedA._id), String(supportedB._id)];
    const runOne = new mongoose.Types.ObjectId();
    await seedAdmittedRead({
      runId: runOne,
      observedAt: new Date('2026-09-10T00:00:00Z'),
      listedRowIds,
    });
    const runTwo = new mongoose.Types.ObjectId();
    await seedAdmittedRead({
      runId: runTwo,
      observedAt: new Date('2026-09-11T00:00:00Z'),
      listedRowIds,
    });
    const result = await reconcileBbsTrackRetirementsFromRun(String(runTwo), deps, {});
    expect(result.counts?.governedClaims).toBe(3);
    expect(result.counts?.retiredClaims).toBe(1);
    expect((await Observation.findById(claim._id).lean())?.superseded).toBe(true);
  }, 120_000);
});
