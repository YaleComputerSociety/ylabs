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
    await materializeEntity('researchEntity', { entityKey: ROW }, {});
    await ResearchEntity.updateOne(
      { slug: ROW },
      { $set: { studentVisibilityTier: 'student_ready' } },
    );
  });

  it('holds an orphan whose values another observation states when the engine would still drop one', async () => {
    expect((await ResearchEntity.findOne({ slug: ROW }).lean())?.departments).toEqual(
      expect.arrayContaining(DEPARTMENTS),
    );
    const before = await liveIds();
    const { report, heldSoleEvidence } = await runOrphanedLaneConfigRetirement({
      apply: true,
      configs: GONE,
      refPresence: [],
      scannedRepositories: [],
      lanes: LANES,
      readServedEntity: async () => null,
    });
    const departments = heldSoleEvidence.find(
      (group) => group.row === `researchEntity:${ROW}` && group.field === 'departments',
    );
    expect(departments).toMatchObject({
      basis: 'engine-projection',
      observationIds: [orphanDepartmentsId],
    });
    expect(report.servedFieldsBecomingLessComplete).toEqual({});
    expect(report.rowsStillLessComplete).toBe(0);
    expect(await Observation.exists({ _id: orphanDepartmentsId, superseded: true })).toBeNull();
    expect(before.length - (await liveIds()).length).toBe(report.retiredObservations);
  });

  it('refuses an apply while a row would still serve a less complete field', async () => {
    const before = await liveIds();
    let calls = 0;
    const laterPassesLoseADepartment: typeof projectRow = async (...args) => {
      const plan = await projectRow(...args);
      calls += 1;
      return calls === 1 ? plan : { ...plan, set: { ...plan.set, departments: ['Physics'] } };
    };
    await expect(
      runOrphanedLaneConfigRetirement({
        apply: true,
        configs: GONE,
        refPresence: [],
        scannedRepositories: [],
        lanes: LANES,
        readServedEntity: async () => null,
        projectResearchEntity: laterPassesLoseADepartment,
      }),
    ).rejects.toThrow(/would still serve a less complete field/);
    expect(await liveIds()).toEqual(before);
  });
});
