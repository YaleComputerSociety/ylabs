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

const STORED_CARD =
  'Studies microscopy methods that push the temporal and spatial resolution of fluorescence imaging past the limits of conventional light microscopy.';

const GENERIC_LOGISTICS_FULL =
  'The lab focuses on developing advanced fluorescence microscopy techniques for biological research.';

const RICH_MICROSITE_FULL =
  'Instrument development in the group spans single-molecule localization, adaptive optics and cryogenic sample preparation, and the team builds open hardware and reconstruction pipelines so that collaborators can image organelle dynamics in intact tissue.';

const SHORTER_ALTERNATIVE_FULL =
  'Interests listed: fluorescence imaging, adaptive optics, instrument design.';

const LONGER_THAN_CARD_WINNER =
  'The group designs optical instruments and computational reconstruction methods for imaging subcellular structure, and applies them with collaborators to study how organelles reorganize during cell division in intact tissue samples.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('materializeEntity prefers a fullDescription that is not thinner than the card (#2259)', () => {
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
      slug: 'card-inversion-fixture',
      name: 'Imaging Methods Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: STORED_CARD,
      ...overrides,
    });

  const seedFull = async (
    value: string,
    sourceName: string,
    confidence: number,
    observedAt: string,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'card-inversion-fixture',
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.edu/${sourceName}/`,
      confidence,
      observedAt: new Date(observedAt),
      superseded: false,
    });
  };

  const materialize = () =>
    materializeEntity(
      'researchEntity',
      { entityKey: 'card-inversion-fixture' },
      { synthesizeCardDescription: async () => '' },
    );

  const persisted = () =>
    ResearchEntity.findOne({ slug: 'card-inversion-fixture' }).lean<PersistedEntity>();

  it('promotes a lower-ranked full over a top-ranked one that is thinner than the stored card', async () => {
    await seedEntity();
    await seedFull(
      GENERIC_LOGISTICS_FULL,
      'lab-microsite-undergrad-llm',
      0.55,
      '2026-08-01T00:00:00Z',
    );
    await seedFull(
      RICH_MICROSITE_FULL,
      'lab-microsite-description-llm',
      0.82,
      '2026-01-01T00:00:00Z',
    );

    await materialize();

    const row = await persisted();
    expect(row?.fullDescription).toBe(RICH_MICROSITE_FULL);
    expect((row?.fullDescription || '').length).toBeGreaterThanOrEqual(STORED_CARD.length);
  });

  it('keeps the top-ranked full when no candidate is at least as long as the card', async () => {
    await seedEntity();
    await seedFull(
      GENERIC_LOGISTICS_FULL,
      'lab-microsite-undergrad-llm',
      0.55,
      '2026-08-01T00:00:00Z',
    );
    await seedFull(SHORTER_ALTERNATIVE_FULL, 'dept-faculty-roster', 0.4, '2026-01-01T00:00:00Z');

    await materialize();

    expect((await persisted())?.fullDescription).toBe(GENERIC_LOGISTICS_FULL);
  });

  it('leaves a top-ranked full that already carries more than the card in place', async () => {
    await seedEntity();
    await seedFull(
      LONGER_THAN_CARD_WINNER,
      'lab-microsite-description-llm',
      0.82,
      '2026-08-01T00:00:00Z',
    );
    await seedFull(
      RICH_MICROSITE_FULL,
      'lab-microsite-undergrad-llm',
      0.55,
      '2026-01-01T00:00:00Z',
    );

    await materialize();

    expect((await persisted())?.fullDescription).toBe(LONGER_THAN_CARD_WINNER);
  });

  it('does not treat a self-derived card as exempt from the inversion check', async () => {
    await seedEntity({
      fieldProvenance: {
        fullDescription: {
          sourceName: 'lab-microsite-undergrad-llm',
          sourceUrl: 'https://example.edu/lab-microsite-undergrad-llm/',
        },
        shortDescription: {
          sourceName: 'lab-microsite-undergrad-llm',
          sourceUrl: 'https://example.edu/lab-microsite-undergrad-llm/',
        },
      },
    });
    await seedFull(
      GENERIC_LOGISTICS_FULL,
      'lab-microsite-undergrad-llm',
      0.55,
      '2026-08-01T00:00:00Z',
    );
    await seedFull(
      RICH_MICROSITE_FULL,
      'lab-microsite-description-llm',
      0.82,
      '2026-01-01T00:00:00Z',
    );

    await materialize();

    expect((await persisted())?.fullDescription).toBe(RICH_MICROSITE_FULL);
  });
});
