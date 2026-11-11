import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import { runOrphanedLaneConfigRetirement } from '../retireOrphanedLaneConfigs';
import type { OrphanLaneDefinition } from '../retireOrphanedLaneConfigsCore';

const ROSTER = 'dept-faculty-roster';
const ROW = 'dept-gone-lane-ash-kerr';
const ORPHAN_SITE = 'https://orphan-site.example.org/';
const LANE_SITE = 'https://kerr-lab.example.org/';
const ORPHAN_ONLY_ROW = 'dept-gone-lane-bo-fenn';
const PROFILE_LANE = 'research-page-text';
const LANES: OrphanLaneDefinition[] = [
  {
    sourceName: ROSTER,
    currentConfigIds: ['chem'],
    currentKeyNamespaces: ['chem'],
    keyNamespaceOf: (configId) => configId,
  },
];

describe('observations:retire-orphaned-lane-configs served projection (#5807)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Promise.all([Observation.createIndexes(), ResearchEntity.createIndexes()]);
    const source = await Source.create({ name: ROSTER, displayName: 'Roster', defaultWeight: 0.8 });
    const run = await ScrapeRun.create({
      sourceId: source._id,
      sourceName: ROSTER,
      startedAt: new Date('2026-05-22T00:00:00Z'),
      status: 'success',
      options: { only: ['gone-lane'] },
    });
    const profileSource = await Source.create({
      name: PROFILE_LANE,
      displayName: 'Profiles',
      defaultWeight: 0.6,
    });
    const profileRun = await ScrapeRun.create({
      sourceId: profileSource._id,
      sourceName: PROFILE_LANE,
      startedAt: new Date('2026-10-01T00:00:00Z'),
      status: 'success',
      codeSha: 'c'.repeat(40),
    });
    const observe = (entityKey: string, field: string, value: unknown, fromProfile = false) =>
      Observation.create({
        entityType: 'researchEntity',
        entityKey,
        field,
        value,
        sourceId: fromProfile ? profileSource._id : source._id,
        sourceName: fromProfile ? PROFILE_LANE : ROSTER,
        scrapeRunId: fromProfile ? profileRun._id : run._id,
        sourceUrl: fromProfile
          ? 'https://profiles.example.edu/kerr'
          : 'https://dept.example.edu/people',
        confidence: fromProfile ? 0.3 : 0.95,
        observedAt: new Date(fromProfile ? '2026-01-01T00:00:00Z' : '2026-05-22T00:00:00Z'),
      });
    await observe(ROW, 'name', 'Kerr Lab');
    await observe(ROW, 'entityType', 'LAB');
    await observe(ROW, 'websiteUrl', ORPHAN_SITE);
    await observe(ROW, 'name', 'Kerr Lab', true);
    await observe(ROW, 'entityType', 'LAB', true);
    await observe(ROW, 'websiteUrl', LANE_SITE, true);
    await observe(ORPHAN_ONLY_ROW, 'name', 'Fenn Lab');
    await observe(ORPHAN_ONLY_ROW, 'entityType', 'LAB');
    await observe(ORPHAN_ONLY_ROW, 'websiteUrl', 'https://fenn-lab.example.org/');
    for (const entityKey of [ROW, ORPHAN_ONLY_ROW]) {
      await materializeEntity('researchEntity', { entityKey }, {});
      await ResearchEntity.updateOne(
        { slug: entityKey },
        { $set: { studentVisibilityTier: 'student_ready' } },
      );
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it('reports the served fields that lose their only evidence, and writes nothing', async () => {
    const before = await ResearchEntity.findOne({ slug: ROW }).lean();
    expect(before?.websiteUrl).toBe(ORPHAN_SITE);
    const { report, rows } = await runOrphanedLaneConfigRetirement({
      apply: false,
      configs: [{ sourceName: ROSTER, configId: 'gone-lane' }],
      refPresence: [],
      scannedRepositories: [],
      lanes: LANES,
      codeShasOnRef: (codeShas) => new Set(codeShas),
      readServedEntity: async () => ({ websiteUrl: ORPHAN_SITE }),
    });
    expect(report.affectedServedResearchRows).toBe(2);
    expect(report.servedRowsLeftWithoutOwnEvidence).toBe(1);
    const byKey = new Map(rows.map((row) => [row.entityKey, row]));
    const website = byKey.get(ROW)?.changes.find((change) => change.field === 'websiteUrl');
    expect(website).toMatchObject({
      servedBefore: ORPHAN_SITE,
      projectedWithOrphans: ORPHAN_SITE,
      projectedWithoutOrphans: LANE_SITE,
      creditedToRetired: true,
      becomesEmpty: false,
    });
    expect(byKey.get(ORPHAN_ONLY_ROW)).toMatchObject({ liveObservationsAfter: 0 });
    expect(await Observation.countDocuments({ superseded: true })).toBe(0);
    expect((await ResearchEntity.findOne({ slug: ROW }).lean())?.websiteUrl).toBe(ORPHAN_SITE);
    expect(await Observation.countDocuments({ superseded: { $ne: true } })).toBe(9);
  });
});
