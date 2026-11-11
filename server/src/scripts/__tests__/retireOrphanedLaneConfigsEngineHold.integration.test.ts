import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../../scrapers/invalidatedScrapeRuns';
import { projectRow, runOrphanedLaneConfigRetirement } from '../retireOrphanedLaneConfigs';
import type { OrphanLaneDefinition } from '../retireOrphanedLaneConfigsCore';

const ROSTER = 'dept-faculty-roster';
const OTHER_LANE = 'research-page-text';
const ROW = 'dept-gone-lane-cy-dorn';
const DEPARTMENTS = ['Applied Physics', 'Physics'];
const LANES: OrphanLaneDefinition[] = [
  {
    sourceName: ROSTER,
    currentConfigIds: ['chem'],
    currentKeyNamespaces: ['chem'],
    keyNamespaceOf: (configId) => configId,
  },
];
const GONE = [{ sourceName: ROSTER, configId: 'gone-lane' }];

const liveIds = async () =>
  (
    await Observation.find({ superseded: { $ne: true } })
      .select('_id')
      .lean()
  )
    .map((row) => String(row._id))
    .sort();

describe('observations:retire-orphaned-lane-configs engine-projection hold (#5807)', () => {
  let replSet: MongoMemoryReplSet;
  let orphanDepartmentsId: string;
  let liveRunId: mongoose.Types.ObjectId;
  let liveSourceId: mongoose.Types.ObjectId;
  let rosterSourceId: mongoose.Types.ObjectId;
  let invalidatedRunId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Promise.all([Observation.createIndexes(), ResearchEntity.createIndexes()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    await Promise.all(
      ['observations', 'scrape_runs', 'sources'].map((name) => db.collection(name).deleteMany({})),
    );
    await ResearchEntity.collection.deleteMany({});
    resetInvalidatedScrapeRunCache();
    const roster = await Source.create({ name: ROSTER, displayName: 'Roster', defaultWeight: 0.8 });
    const other = await Source.create({
      name: OTHER_LANE,
      displayName: 'Pages',
      defaultWeight: 0.6,
    });
    const orphanRun = await ScrapeRun.create({
      sourceId: roster._id,
      sourceName: ROSTER,
      startedAt: new Date('2026-05-22T00:00:00Z'),
      status: 'success',
      options: { only: ['gone-lane'] },
    });
    const liveRun = await ScrapeRun.create({
      sourceId: other._id,
      sourceName: OTHER_LANE,
      startedAt: new Date('2026-10-01T00:00:00Z'),
      status: 'success',
      codeSha: 'c'.repeat(40),
    });
    const invalidatedRun = await ScrapeRun.create({
      sourceId: other._id,
      sourceName: OTHER_LANE,
      startedAt: new Date('2026-09-01T00:00:00Z'),
      status: 'success',
      codeSha: 'd'.repeat(40),
      invalidated: true,
    });
    const observe = (
      field: string,
      value: unknown,
      run: { _id: mongoose.Types.ObjectId; sourceId: mongoose.Types.ObjectId; sourceName: string },
    ) =>
      Observation.create({
        entityType: 'researchEntity',
        entityKey: ROW,
        field,
        value,
        sourceId: run.sourceId,
        sourceName: run.sourceName,
        scrapeRunId: run._id,
        sourceUrl: 'https://dept.example.edu/people',
        confidence: 0.9,
        observedAt: new Date('2026-05-22T00:00:00Z'),
      });
    await observe('name', 'Dorn Lab', orphanRun);
    await observe('entityType', 'LAB', orphanRun);
    orphanDepartmentsId = String(
      ((await observe('departments', DEPARTMENTS, orphanRun)) as { _id: unknown })._id,
    );
    await observe('name', 'Dorn Lab', liveRun);
    await observe('entityType', 'LAB', liveRun);
    await observe('departments', ['Physics'], liveRun);
    await observe('departments', DEPARTMENTS, invalidatedRun);
    liveRunId = liveRun._id as mongoose.Types.ObjectId;
    liveSourceId = other._id as mongoose.Types.ObjectId;
    rosterSourceId = roster._id as mongoose.Types.ObjectId;
    invalidatedRunId = invalidatedRun._id as mongoose.Types.ObjectId;
    await materializeEntity('researchEntity', { entityKey: ROW }, {});
    await ResearchEntity.updateOne(
      { slug: ROW },
      { $set: { studentVisibilityTier: 'student_ready' } },
    );
  });

  const runRetirement = (projectResearchEntity?: typeof projectRow) =>
    runOrphanedLaneConfigRetirement({
      apply: true,
      configs: GONE,
      refPresence: [],
      scannedRepositories: [],
      lanes: LANES,
      readServedEntity: async () => null,
      ...(projectResearchEntity ? { projectResearchEntity } : {}),
    });
  const heldDepartments = (
    heldSoleEvidence: Awaited<ReturnType<typeof runRetirement>>['heldSoleEvidence'],
  ) =>
    heldSoleEvidence.find(
      (group) => group.row === `researchEntity:${ROW}` && group.field === 'departments',
    );

  it('holds an orphan the engine would not produce once the stored value it backs is cleared', async () => {
    await Observation.deleteMany({ field: 'departments', scrapeRunId: liveRunId });
    const otherDepartmentsEvidence = await Observation.find({
      field: 'departments',
      _id: { $ne: orphanDepartmentsId },
    })
      .select('scrapeRunId')
      .lean();
    expect(otherDepartmentsEvidence.map((row) => String(row.scrapeRunId))).toEqual([
      String(invalidatedRunId),
    ]);
    const stored = await ResearchEntity.findOne({ slug: ROW }).lean();
    expect(stored?.departments).toEqual(expect.arrayContaining(DEPARTMENTS));
    expect(String(stored?.fieldProvenance?.departments?.observationId)).toBe(orphanDepartmentsId);

    const servedProjection = await projectRow('researchEntity', ROW, [
      new mongoose.Types.ObjectId(orphanDepartmentsId),
    ]);
    expect(servedProjection.set.departments).toBeUndefined();

    const { report, heldSoleEvidence } = await runRetirement();
    expect(report.servedFieldsBecomingLessComplete).toEqual({});
    expect(heldDepartments(heldSoleEvidence)).toMatchObject({
      basis: 'engine-would-not-produce',
      observationIds: [orphanDepartmentsId],
    });
    expect(await Observation.exists({ _id: orphanDepartmentsId, superseded: true })).toBeNull();
  });

  it('retires an orphan whose departments a merged-in row still gives the engine', async () => {
    await Observation.deleteMany({ field: 'departments', scrapeRunId: liveRunId });
    const survivor = await ResearchEntity.findOne({ slug: ROW }).select('_id').lean();
    const shellSlug = 'dept-chem-cy-dorn';
    await ResearchEntity.collection.insertOne({
      _id: new mongoose.Types.ObjectId(),
      slug: shellSlug,
      name: 'Dorn Lab',
      archived: true,
      archivedReason: 'materialize:fold-dept-roster-shell',
      canonicalGroupId: survivor!._id,
    });
    const rosterRun = await ScrapeRun.create({
      sourceId: rosterSourceId,
      sourceName: ROSTER,
      startedAt: new Date('2026-10-23T00:00:00Z'),
      status: 'success',
      codeSha: 'e'.repeat(40),
      options: { only: ['chem'] },
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: shellSlug,
      field: 'departments',
      value: DEPARTMENTS,
      sourceId: rosterSourceId,
      sourceName: ROSTER,
      scrapeRunId: rosterRun._id,
      sourceUrl: 'https://dept.example.edu/people/dorn',
      confidence: 0.7,
      observedAt: new Date(),
    });
    const { heldSoleEvidence } = await runRetirement();
    expect(heldDepartments(heldSoleEvidence)).toBeUndefined();
    expect(await Observation.exists({ _id: orphanDepartmentsId, superseded: true })).not.toBeNull();
  });

  it('holds an orphan by the served projection when it still loses an item the engine produces', async () => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ROW,
      field: 'departments',
      value: DEPARTMENTS,
      sourceId: liveSourceId,
      sourceName: OTHER_LANE,
      scrapeRunId: liveRunId,
      sourceUrl: 'https://dept.example.edu/people',
      confidence: 0.9,
      observedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const before = await liveIds();
    const servedProjectionLosesAnItem: typeof projectRow = async (
      entityType,
      entityKey,
      excluded,
      identities,
      onlyFields,
      cleared = [],
    ) => {
      const plan = await projectRow(
        entityType,
        entityKey,
        excluded,
        identities,
        onlyFields,
        cleared,
      );
      return cleared.length === 0 && excluded.some((id) => String(id) === orphanDepartmentsId)
        ? { ...plan, set: { ...plan.set, departments: ['Physics'] } }
        : plan;
    };
    const { report, heldSoleEvidence } = await runRetirement(servedProjectionLosesAnItem);
    expect(heldDepartments(heldSoleEvidence)).toMatchObject({
      basis: 'engine-projection',
      observationIds: [orphanDepartmentsId],
    });
    expect(report.rowsStillLessComplete).toBe(0);
    expect(await Observation.exists({ _id: orphanDepartmentsId, superseded: true })).toBeNull();
    expect(before.length - (await liveIds()).length).toBe(report.retiredObservations);
  });

  it('holds an orphan when the projection without it still read retired evidence live', async () => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ROW,
      field: 'departments',
      value: DEPARTMENTS,
      sourceId: liveSourceId,
      sourceName: OTHER_LANE,
      scrapeRunId: liveRunId,
      sourceUrl: 'https://dept.example.edu/people',
      confidence: 0.9,
      observedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const clearedProjectionReadsRetiredEvidenceLive: typeof projectRow = async (
      entityType,
      entityKey,
      excluded,
      identities,
      onlyFields,
      cleared = [],
    ) => {
      const plan = await projectRow(
        entityType,
        entityKey,
        excluded,
        identities,
        onlyFields,
        cleared,
      );
      return cleared.length > 0 && excluded.length > 0
        ? { ...plan, retiredEvidenceReadLive: 1 }
        : plan;
    };
    const { heldSoleEvidence } = await runRetirement(clearedProjectionReadsRetiredEvidenceLive);
    expect(heldDepartments(heldSoleEvidence)).toMatchObject({
      basis: 'engine-would-not-produce',
      observationIds: [orphanDepartmentsId],
    });
    expect(await Observation.exists({ _id: orphanDepartmentsId, superseded: true })).toBeNull();
  });

  it('refuses an apply while a row would still serve a less complete field', async () => {
    const before = await liveIds();
    let servedCalls = 0;
    const laterPassesLoseADepartment: typeof projectRow = async (
      entityType,
      entityKey,
      excluded,
      identities,
      onlyFields,
      cleared = [],
    ) => {
      const plan = await projectRow(
        entityType,
        entityKey,
        excluded,
        identities,
        onlyFields,
        cleared,
      );
      if (cleared.length > 0) return plan;
      servedCalls += 1;
      return servedCalls === 1 ? plan : { ...plan, set: { ...plan.set, departments: ['Physics'] } };
    };
    await expect(runRetirement(laterPassesLoseADepartment)).rejects.toThrow(
      /would still serve a less complete field/,
    );
    expect(await liveIds()).toEqual(before);
  });
});
