import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
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
import { materializeEntity } from '../entityMaterializer';

type ProjectedSurvivor = {
  name?: string;
  kind?: string;
  websiteUrl?: string;
  researchAreas?: string[];
  archived?: boolean;
};

describe('a merged survivor resolves over its tombstoned losers evidence (#3560)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName = 'ysm-faculty-directory',
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.yale.edu/${entityKey}/`,
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  const projectSurvivor = async (id: mongoose.Types.ObjectId) => {
    const doc = await ResearchEntity.findById(id).lean<ProjectedSurvivor>();
    return {
      name: doc?.name,
      kind: doc?.kind,
      websiteUrl: doc?.websiteUrl ?? '',
      researchAreas: [...(doc?.researchAreas ?? [])].sort(),
      archived: doc?.archived,
    };
  };

  const seedMerge = async (loserSlug: string) => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: loserSlug,
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab');
    await seedObservation('example-lead-lab', 'researchAreas', ['Neuroscience']);
    await seedObservation(loserSlug, 'name', 'Example Lead Research', 'dept-faculty-roster');
    await seedObservation(
      loserSlug,
      'websiteUrl',
      'https://examplelead.yale.edu/',
      'dept-faculty-roster',
    );
    return survivor;
  };

  it('keeps a loser-only value when the survivor re-resolves under its own key', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const projected = await projectSurvivor(survivor._id);
    expect(projected.websiteUrl).toBe('https://examplelead.yale.edu/');
    expect(projected.name).toBe('Example Lead Lab');
    expect(projected.researchAreas).toContain('Neuroscience');
  });

  it('projects the same survivor from either entry point and on a second run', async () => {
    const survivor = await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    const viaSurvivor = await projectSurvivor(survivor._id);
    await materializeEntity('researchEntity', { entityKey: 'ysm-faculty-example-lead' });
    const viaLoser = await projectSurvivor(survivor._id);
    await materializeEntity('researchEntity', { entityId: survivor._id.toHexString() });
    const viaSurvivorAgain = await projectSurvivor(survivor._id);

    expect(viaLoser).toEqual(viaSurvivor);
    expect(viaSurvivorAgain).toEqual(viaSurvivor);
    expect(viaSurvivor.name).toBe('Example Lead Lab');
  });

  it('resolves a survivor that has no evidence of its own from its losers', async () => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'ysm-faculty-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation(
      'ysm-faculty-example-lead',
      'websiteUrl',
      'https://examplelead.yale.edu/',
    );

    const result = await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect(result.fieldsWritten).toBeGreaterThan(0);
    expect((await projectSurvivor(survivor._id)).websiteUrl).toBe('https://examplelead.yale.edu/');
  });

  it.each(['nih-pi-example-lead', 'faculty-research-area-example-lead'])(
    'refuses a low-trust %s shell topics from both entry points',
    async (shellSlug) => {
      const survivor = await seedMerge(shellSlug);
      await seedObservation(shellSlug, 'researchAreas', ['Grant Topic'], 'nih-reporter');

      await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
      const viaSurvivor = await projectSurvivor(survivor._id);
      await materializeEntity('researchEntity', { entityKey: shellSlug });
      const viaShell = await projectSurvivor(survivor._id);

      expect(viaSurvivor.researchAreas).not.toContain('Grant Topic');
      expect(viaShell).toEqual(viaSurvivor);
      expect(viaSurvivor.websiteUrl).toBe('https://examplelead.yale.edu/');
    },
  );

  it('carries a trusted loser topics onto the survivor', async () => {
    const survivor = await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'ysm-faculty-example-lead',
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab');
    await seedObservation('ysm-faculty-example-lead', 'researchAreas', ['Synaptic Plasticity']);

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect((await projectSurvivor(survivor._id)).researchAreas).toContain('Synaptic Plasticity');
  });

  it('leaves the shell archived and unwritten', async () => {
    await seedMerge('ysm-faculty-example-lead');

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const shell = await ResearchEntity.findOne({
      slug: 'ysm-faculty-example-lead',
    }).lean<ProjectedSurvivor>();
    expect(shell?.archived).toBe(true);
    expect(shell?.websiteUrl ?? '').toBe('');
  });
});
