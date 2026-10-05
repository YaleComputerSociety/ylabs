import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { reconcileBbsTrackRetirementsFromRun } from '../bbsTrackRosterRetirement';
import { materializeEntity } from '../entityMaterializer';
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
  });

  afterEach(async () => {
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  const deps = {
    rematerializeResearchEntity: async (identifier: { entityId?: string; entityKey?: string }) => {
      await materializeEntity('researchEntity', identifier);
    },
  };

  it('governs an entityKey-only claim on a live row, retires it only after two admitted reads, and removes the label from the stored row', async () => {
    const row = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-one',
      name: 'Synthetic One Research',
      researchAreas: ['Immunology'],
    });
    const claim = await seedClaim({ entityKey: 'ysm-faculty-synthetic-one' });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'ysm-faculty-synthetic-one',
      field: 'researchAreas',
      sourceId,
      sourceName: 'ysm-faculty-directory',
      value: ['Neuroscience'],
      confidence: 0.9,
      superseded: false,
      observedAt: new Date('2026-08-27T00:00:00Z'),
    });
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
    const reprojected = (await ResearchEntity.findById(row._id).lean()) as {
      researchAreas?: string[];
    } | null;
    expect(reprojected?.researchAreas).toEqual(['Neuroscience']);
  });

  it('excludes a claim in either identity form that names no live row rather than counting it absent', async () => {
    const other = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-two',
      name: 'Synthetic Two Research',
    });
    const orphan = await seedClaim({ entityKey: 'ysm-faculty-row-that-no-longer-exists' });
    const archived = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-archived',
      name: 'Synthetic Archived Research',
      archived: true,
    });
    const archivedOrphan = await seedClaim({ entityId: archived._id as mongoose.Types.ObjectId });
    const deletedOrphan = await seedClaim({ entityId: new mongoose.Types.ObjectId() });

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
    expect(result.counts?.orphanedClaims).toBe(3);
    expect(result.counts?.governedClaims).toBe(0);
    for (const claim of [orphan, archivedOrphan, deletedOrphan]) {
      expect((await Observation.findById(claim._id).lean())?.superseded).not.toBe(true);
    }
  });

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
  });

  it('retires an older claim once the run resolves the same PI to another row, and leaves claims the run did not contradict (#3834)', async () => {
    const lanesOldRow = await ResearchEntity.create({
      slug: 'bbs-synthetic-pi',
      name: 'Synthetic Pi Faculty Research',
      researchAreas: ['Retired Compound Track'],
    });
    const canonicalRow = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-pi',
      name: 'Synthetic Pi Research',
    });
    const unresolvedRow = await ResearchEntity.create({
      slug: 'bbs-synthetic-unresolved',
      name: 'Synthetic Unresolved Faculty Research',
    });
    const claimFor = (
      identity: { entityId?: mongoose.Types.ObjectId; entityKey?: string },
      sourceUrl: string,
      extra: Record<string, unknown> = {},
    ) =>
      Observation.create({
        entityType: 'researchEntity',
        field: 'researchAreas',
        sourceId,
        sourceName: 'bbs-research-track',
        value: ['Retired Compound Track'],
        confidence: 0.7,
        superseded: false,
        observedAt: new Date('2026-08-27T00:00:00Z'),
        sourceUrl,
        ...identity,
        ...extra,
      });
    const movedClaim = await claimFor(
      { entityKey: 'bbs-synthetic-pi' },
      'https://medicine.yale.edu/bbs/profile/synthetic-pi/',
    );
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'bbs-synthetic-pi',
      field: 'name',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      value: 'Synthetic Pi Faculty Research',
      confidence: 0.9,
      superseded: false,
      observedAt: new Date('2026-08-27T00:00:00Z'),
    });
    await ResearchEntity.collection.updateOne(
      { _id: lanesOldRow._id },
      {
        $set: {
          'fieldProvenance.researchAreas': {
            sourceName: 'bbs-research-track',
            observationId: movedClaim._id,
          },
        },
      },
    );
    const untouchedClaim = await claimFor(
      { entityKey: 'bbs-synthetic-unresolved' },
      'https://medicine.yale.edu/bbs/profile/synthetic-unresolved/',
    );

    const run = new mongoose.Types.ObjectId();
    const currentGraft = await claimFor(
      { entityId: canonicalRow._id as mongoose.Types.ObjectId },
      'https://medicine.yale.edu/profile/synthetic-pi-canonical/',
      { scrapeRunId: run, value: ['Immunology'], observedAt: new Date('2026-09-29T00:00:00Z') },
    );
    await Observation.create({
      entityType: 'centerRosterHealth',
      entityKey: BBS_TRACKS[0].slug,
      field: 'centerRosterHealth',
      sourceId,
      sourceName: 'bbs-research-track',
      scrapeRunId: run,
      observedAt: new Date('2026-09-29T00:00:00Z'),
      confidence: 0.7,
      superseded: false,
      value: {
        centerKey: BBS_TRACKS[0].slug,
        entityKey: BBS_TRACKS[0].slug,
        status: 'ok',
        complete: true,
        claimEntityKeysRecorded: true,
        discoveredCount: 2,
        members: [
          { memberKey: 'synthetic-pi', role: 'track-pi', claimEntityKey: String(canonicalRow._id) },
          { memberKey: 'synthetic-unresolved', role: 'track-pi' },
        ],
        read: {
          pagesRead: 1,
          readMode: 'html',
          cacheAllowed: false,
          stopReason: 'not-paginated',
          readAt: '2026-09-29T00:00:00.000Z',
        },
      },
    });

    const result = await reconcileBbsTrackRetirementsFromRun(String(run), deps, {});

    expect(result.outcome).toBe('reconciled');
    expect(result.counts?.movedClaims).toBe(1);
    expect((await Observation.findById(movedClaim._id).lean())?.superseded).toBe(true);
    expect((await Observation.findById(untouchedClaim._id).lean())?.superseded).not.toBe(true);
    expect((await Observation.findById(currentGraft._id).lean())?.superseded).not.toBe(true);
    const reprojected = (await ResearchEntity.findById(lanesOldRow._id).lean()) as {
      researchAreas?: string[];
    } | null;
    expect(reprojected?.researchAreas ?? []).not.toContain('Retired Compound Track');
    const untouchedRow = (await ResearchEntity.findById(unresolvedRow._id).lean()) as {
      researchAreas?: string[];
    } | null;
    expect(untouchedRow?.researchAreas ?? []).toEqual([]);
  });

  it('moves nothing on a dry run', async () => {
    const lanesOldRow = await ResearchEntity.create({
      slug: 'bbs-synthetic-dry',
      name: 'Synthetic Dry Faculty Research',
    });
    const canonicalRow = await ResearchEntity.create({
      slug: 'ysm-faculty-synthetic-dry',
      name: 'Synthetic Dry Research',
    });
    const base = {
      entityType: 'researchEntity' as const,
      field: 'researchAreas',
      sourceId,
      sourceName: 'bbs-research-track',
      confidence: 0.7,
      superseded: false,
    };
    const staleClaim = await Observation.create({
      ...base,
      entityKey: lanesOldRow.slug,
      value: ['Retired Compound Track'],
      observedAt: new Date('2026-08-27T00:00:00Z'),
      sourceUrl: 'https://medicine.yale.edu/profile/synthetic-dry/',
    });
    await Observation.create({
      ...base,
      entityId: canonicalRow._id,
      value: ['Immunology'],
      observedAt: new Date('2026-08-27T00:00:00Z'),
      sourceUrl: 'https://medicine.yale.edu/profile/synthetic-dry/',
    });
    const run = new mongoose.Types.ObjectId();
    await Observation.create({
      ...base,
      entityId: canonicalRow._id,
      value: ['Immunology'],
      scrapeRunId: run,
      observedAt: new Date('2026-09-29T00:00:00Z'),
      sourceUrl: 'https://medicine.yale.edu/profile/synthetic-dry/',
    });
    await seedAdmittedRead({
      runId: run,
      observedAt: new Date('2026-09-29T00:00:00Z'),
      listedRowIds: [String(canonicalRow._id)],
    });

    const result = await reconcileBbsTrackRetirementsFromRun(String(run), deps, { dryRun: true });

    expect(result.counts?.movedClaims).toBe(1);
    expect((await Observation.findById(staleClaim._id).lean())?.superseded).not.toBe(true);
  });
});
