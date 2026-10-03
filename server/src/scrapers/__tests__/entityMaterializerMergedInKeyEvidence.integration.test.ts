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
import { Signal } from '../../models/signal';
import { materializeEntity } from '../entityMaterializer';

const TRACK_SOURCE = 'bbs-research-track';
const SURVIVOR_KEY = 'example-lead-lab';
const LOSER_KEY = 'ysm-faculty-example-lead';

type StoredSurvivor = {
  researchAreas?: string[];
  recentGrants?: Array<{ id?: string }>;
  recentGrantCount?: number;
  school?: string;
  fieldProvenance?: Record<string, { sourceName?: string }>;
};

describe('a merged survivor reads the evidence filed under its merged-in keys (#4418)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
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
    await Signal.deleteMany({});
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName: string,
    overrides: { observedAt?: Date; retired?: boolean } = {},
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.yale.edu/${entityKey}/`,
      confidence: 0.7,
      observedAt: overrides.observedAt ?? new Date('2026-02-01T00:00:00Z'),
      superseded: overrides.retired === true,
      ...(overrides.retired
        ? { rollback: { rolledBackAt: new Date('2026-03-01T00:00:00Z'), reason: 'synthetic' } }
        : {}),
    });

  const seedMergedPair = async (survivorFields: Record<string, unknown> = {}) => {
    const survivor = await ResearchEntity.create({
      slug: SURVIVOR_KEY,
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
      ...survivorFields,
    });
    await ResearchEntity.create({
      slug: LOSER_KEY,
      name: 'Example Lead Research',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation(SURVIVOR_KEY, 'name', 'Example Lead Lab', 'ysm-faculty-directory');
    return survivor;
  };

  const stored = async (id: mongoose.Types.ObjectId) =>
    (await ResearchEntity.findById(id).lean<StoredSurvivor>()) ?? {};

  const seedTrackOnlySurvivorWithOwnTopicsOnLoser = async (loserTopics: { retired?: boolean }) => {
    const survivor = await seedMergedPair();
    await seedObservation(
      SURVIVOR_KEY,
      'researchAreas',
      ['Immunology', 'Microbiology'],
      TRACK_SOURCE,
      {
        observedAt: new Date('2026-09-01T00:00:00Z'),
      },
    );
    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });
    await seedObservation(
      LOSER_KEY,
      'researchAreas',
      ['Synaptic Plasticity', 'Neural Circuits'],
      'ysm-faculty-directory',
      { retired: loserTopics.retired },
    );
    return survivor;
  };

  it('serves own-profile topics filed under a merged-in key over a graduate-track list on the survivor', async () => {
    const survivor = await seedTrackOnlySurvivorWithOwnTopicsOnLoser({});

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });
    const viaSurvivor = [...((await stored(survivor._id)).researchAreas ?? [])].sort();
    await materializeEntity('researchEntity', { entityKey: LOSER_KEY });
    const viaLoser = [...((await stored(survivor._id)).researchAreas ?? [])].sort();
    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });
    const secondRun = [...((await stored(survivor._id)).researchAreas ?? [])].sort();

    expect(viaSurvivor).toEqual(['Neural Circuits', 'Synaptic Plasticity']);
    expect(viaLoser).toEqual(viaSurvivor);
    expect(secondRun).toEqual(viaSurvivor);
  });

  it('does not bring back a retracted topic list filed under a merged-in key', async () => {
    const survivor = await seedTrackOnlySurvivorWithOwnTopicsOnLoser({ retired: true });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });
    await materializeEntity('researchEntity', { entityKey: LOSER_KEY });

    expect([...((await stored(survivor._id)).researchAreas ?? [])].sort()).toEqual([
      'Immunology',
      'Microbiology',
    ]);
  });

  it('still keeps the survivor own non-track topics against a merged-in list', async () => {
    const survivor = await seedMergedPair();
    await seedObservation(SURVIVOR_KEY, 'researchAreas', ['Immunology'], TRACK_SOURCE);
    await seedObservation(SURVIVOR_KEY, 'researchAreas', ['Neuroscience'], 'dept-faculty-roster');
    await seedObservation(
      LOSER_KEY,
      'researchAreas',
      ['Synaptic Plasticity'],
      'ysm-faculty-directory',
      {
        observedAt: new Date('2026-09-01T00:00:00Z'),
      },
    );

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });

    expect((await stored(survivor._id)).researchAreas).toEqual(['Neuroscience']);
  });

  const award = (id: string) => ({ id, title: `Synthetic award ${id}`, agency: 'NIH' });

  it('drops a merged-in key award list that the same lane has since re-read on the survivor', async () => {
    const survivor = await seedMergedPair();
    await seedObservation(
      LOSER_KEY,
      'recentGrants',
      [award('1R01XX000001-01'), award('5R01XX000001-02'), award('1R21XX000002-01')],
      'nih-reporter',
      { observedAt: new Date('2026-05-01T00:00:00Z') },
    );
    await seedObservation(LOSER_KEY, 'recentGrantCount', 3, 'nih-reporter', {
      observedAt: new Date('2026-05-01T00:00:00Z'),
    });
    await seedObservation(SURVIVOR_KEY, 'recentGrants', [award('R01XX000001')], 'nih-reporter', {
      observedAt: new Date('2026-10-01T00:00:00Z'),
    });
    await seedObservation(SURVIVOR_KEY, 'recentGrantCount', 1, 'nih-reporter', {
      observedAt: new Date('2026-10-01T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });
    const viaSurvivor = await stored(survivor._id);
    await materializeEntity('researchEntity', { entityKey: LOSER_KEY });
    const viaLoser = await stored(survivor._id);

    expect((viaSurvivor.recentGrants ?? []).map((grant) => grant.id)).toEqual(['R01XX000001']);
    expect(viaSurvivor.recentGrantCount).toBe(1);
    expect((viaLoser.recentGrants ?? []).map((grant) => grant.id)).toEqual(['R01XX000001']);
  });

  it('still unions award lists that different lanes filed under different keys', async () => {
    const survivor = await seedMergedPair();
    await seedObservation(SURVIVOR_KEY, 'recentGrants', [award('R01XX000001')], 'nih-reporter', {
      observedAt: new Date('2026-10-01T00:00:00Z'),
    });
    await seedObservation(
      LOSER_KEY,
      'recentGrants',
      [{ id: 'NSF-0000001', title: 'Synthetic award', agency: 'NSF' }],
      'nsf-award-search',
      { observedAt: new Date('2026-05-01T00:00:00Z') },
    );

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });

    expect(
      ((await stored(survivor._id)).recentGrants ?? []).map((grant) => grant.id).sort(),
    ).toEqual(['NSF-0000001', 'R01XX000001']);
  });

  it('keeps provenance naming a lane that observed the field only under a merged-in key', async () => {
    const survivor = await seedMergedPair();
    await ResearchEntity.collection.updateOne(
      { _id: survivor._id },
      {
        $set: {
          school: 'Example School',
          fieldProvenance: { school: { sourceName: 'dept-faculty-roster', sourceUrl: '' } },
        },
      },
    );
    await seedObservation(LOSER_KEY, 'school', 'Example School', 'dept-faculty-roster');

    const result = await materializeEntity(
      'researchEntity',
      { entityKey: SURVIVOR_KEY },
      { dryRun: true },
    );

    expect(Object.keys(result.plannedUnset ?? {})).not.toContain('fieldProvenance.school');
  });
});
