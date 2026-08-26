import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
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

type PersistedEntity = {
  yaleStatusCache?: string;
  activeAtYaleCache?: boolean;
  sourceUrls?: string[];
};

describe('materializeEntity derives activeAtYaleCache/yaleStatusCache from ingestion signals (#1308)', () => {
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

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'yale-status-fixture',
      name: 'Claude Rawson Research',
      kind: 'individual',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedObservation = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'yale-status-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'department-directory',
      sourceUrl: 'https://english.yale.edu/people/professors-emeritus/claude-rawson',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('does not mark an emeritus source-URL marker as departed (#1929)', async () => {
    await seedEntity();
    await seedObservation('sourceUrls', [
      'https://english.yale.edu/people/professors-emeritus/claude-rawson',
    ]);

    await materializeEntity('researchEntity', { entityKey: 'yale-status-fixture' });

    const persisted = await ResearchEntity.findOne({ slug: 'yale-status-fixture' }).lean<
      PersistedEntity
    >();

    expect(persisted?.activeAtYaleCache).not.toBe(false);
    expect(persisted?.yaleStatusCache ?? 'unknown').toBe('unknown');
  });

  it('sets activeAtYaleCache=false and yaleStatusCache=departed for a deceased-lead description marker', async () => {
    await seedEntity({ name: 'Pierre Demarque Research' });
    await seedObservation(
      'fullDescription',
      'Pierre R. Demarque (1932 - 2025), Munson Professor of Astronomy, studied stellar evolution.',
    );

    await materializeEntity('researchEntity', { entityKey: 'yale-status-fixture' });

    const persisted = await ResearchEntity.findOne({ slug: 'yale-status-fixture' }).lean<
      PersistedEntity
    >();

    expect(persisted?.activeAtYaleCache).toBe(false);
    expect(persisted?.yaleStatusCache).toBe('departed');
  });

  it('leaves activeAtYaleCache untouched when no yale-status signal is present', async () => {
    await seedEntity({ name: 'Jane Doe Research' });
    await seedObservation(
      'fullDescription',
      'The Doe Lab studies reaction kinetics and catalysis, with active undergraduate research opportunities.',
    );

    await materializeEntity('researchEntity', { entityKey: 'yale-status-fixture' });

    const persisted = await ResearchEntity.findOne({ slug: 'yale-status-fixture' }).lean<
      PersistedEntity
    >();

    expect(persisted?.activeAtYaleCache).not.toBe(false);
    expect(persisted?.yaleStatusCache ?? 'unknown').toBe('unknown');
  });

  it('self-heals a stale departed cache back to active when no signal remains (#1916)', async () => {
    await seedEntity({
      name: 'Brian Weiss Research',
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
    });
    await seedObservation(
      'fullDescription',
      'The Weiss Lab studies infectious disease epidemiology, with active research opportunities.',
    );

    await materializeEntity('researchEntity', { entityKey: 'yale-status-fixture' });

    const persisted = await ResearchEntity.findOne({ slug: 'yale-status-fixture' }).lean<
      PersistedEntity
    >();

    expect(persisted?.activeAtYaleCache).toBe(true);
    expect(persisted?.yaleStatusCache).toBe('unknown');
  });

  it('does not self-heal a manually-locked departed cache (#1916)', async () => {
    await seedEntity({
      name: 'Locked Research',
      activeAtYaleCache: false,
      yaleStatusCache: 'departed',
      manuallyLockedFields: ['activeAtYaleCache', 'yaleStatusCache'],
    });
    await seedObservation(
      'fullDescription',
      'The lab studies reaction kinetics, with active undergraduate research opportunities.',
    );

    await materializeEntity('researchEntity', { entityKey: 'yale-status-fixture' });

    const persisted = await ResearchEntity.findOne({ slug: 'yale-status-fixture' }).lean<
      PersistedEntity
    >();

    expect(persisted?.activeAtYaleCache).toBe(false);
    expect(persisted?.yaleStatusCache).toBe('departed');
  });
});
