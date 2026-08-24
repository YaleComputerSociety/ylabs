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
import { synthesizeGroundedCardDescription } from '../../utils/groundedCardSynthesis';

const PUBLICATIONS_DUMP_FULL =
  'The Chen Lab studies immune regulation and cancer immunotherapy across many tumor types. Selected Publications:Rivera J, Chen A. (2023) T cell dynamics in the tumor microenvironment. Cell Reports.';

const ROSTER_DUMP_FULL =
  "Jane Doe '27 Mentor: Professor Alpha. John Smith '26 Mentor: Professor Beta. Mary Lee '28 Mentor: Professor Gamma. Alex Ray '25 Mentor: Professor Delta.";

const CLEAN_MICROSITE_FULL =
  'The Chen Lab investigates the molecular mechanisms of immune regulation and cancer immunotherapy, focusing on how T cells recognize and respond to the tumor microenvironment, and develops single-cell and spatial approaches to map the signaling circuits that shape durable anti-tumor responses in patients.';

const CLEAN_WINNER_FULL =
  'The Park Laboratory studies how epithelial tissues maintain their architecture and regenerate after injury, combining live-imaging, single-cell sequencing, and organoid systems to dissect the signaling circuits that coordinate collective cell behavior across developing and adult tissues.';

const ALTERNATE_CLEAN_FULL =
  'The Park Laboratory investigates tissue regeneration and epithelial signaling, using organoids and imaging to understand how cells coordinate collective behavior during development and repair across multiple model systems.';

const APPOINTMENT_ONLY_ALT =
  'Dr. Avery Park is an Associate Professor of Cell Biology at Yale University.';

const GROUNDED_CARD = 'Studies immune regulation and cancer immunotherapy in the tumor microenvironment.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('materializeEntity falls through to the best quality-passing fullDescription observation (#1684)', () => {
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
      slug: 'fallthrough-fixture',
      name: 'Chen Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
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
      entityKey: 'fallthrough-fixture',
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

  const capturingSynthesizer =
    (calls: string[], card: string = GROUNDED_CARD) =>
    (fullDescription: string) => {
      calls.push(fullDescription);
      return synthesizeGroundedCardDescription({
        fullDescription,
        entityName: 'Chen Lab',
        callLLM: async () => card,
      });
    };

  it('materializes a lower-confidence clean observation when the top-confidence winner sanitizes to empty', async () => {
    await seedEntity();
    await seedFull(PUBLICATIONS_DUMP_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');
    await seedFull(CLEAN_MICROSITE_FULL, 'lab-microsite-description-llm', 0.75, '2026-01-01T00:00:00Z');

    const calls: string[] = [];
    await materializeEntity(
      'researchEntity',
      { entityKey: 'fallthrough-fixture' },
      { synthesizeCardDescription: capturingSynthesizer(calls) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'fallthrough-fixture' }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(CLEAN_MICROSITE_FULL);
    expect(persisted?.fullDescription).not.toContain('Selected Publications');
    expect(calls).toEqual([CLEAN_MICROSITE_FULL]);
    expect(persisted?.shortDescription).toBe(GROUNDED_CARD);
  });

  it('falls through past a roster-shaped winner to the clean observation', async () => {
    await seedEntity();
    await seedFull(ROSTER_DUMP_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');
    await seedFull(CLEAN_MICROSITE_FULL, 'lab-microsite-description-llm', 0.7, '2026-01-01T00:00:00Z');

    await materializeEntity(
      'researchEntity',
      { entityKey: 'fallthrough-fixture' },
      { synthesizeCardDescription: capturingSynthesizer([]) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'fallthrough-fixture' }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(CLEAN_MICROSITE_FULL);
  });

  it('stays empty when the winner blanks and the only alternative is a non-useful bio fragment', async () => {
    await seedEntity({ name: 'Park Laboratory' });
    await seedFull(PUBLICATIONS_DUMP_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');
    await seedFull(APPOINTMENT_ONLY_ALT, 'official-profile-pi-backfill', 0.7, '2026-01-01T00:00:00Z');

    const calls: string[] = [];
    await materializeEntity(
      'researchEntity',
      { entityKey: 'fallthrough-fixture' },
      { synthesizeCardDescription: capturingSynthesizer(calls) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'fallthrough-fixture' }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe('');
    expect(calls).toHaveLength(0);
    expect(persisted?.shortDescription ?? '').toBe('');
  });

  it('does not displace a useful top-confidence winner with a lower-ranked observation', async () => {
    await seedEntity({ name: 'Park Laboratory' });
    await seedFull(CLEAN_WINNER_FULL, 'lab-microsite-description-llm', 0.95, '2026-02-01T00:00:00Z');
    await seedFull(ALTERNATE_CLEAN_FULL, 'department-undergrad-research', 0.7, '2026-01-01T00:00:00Z');

    await materializeEntity(
      'researchEntity',
      { entityKey: 'fallthrough-fixture' },
      { synthesizeCardDescription: capturingSynthesizer([], 'Studies tissue regeneration and epithelial signaling.') },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'fallthrough-fixture' }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(CLEAN_WINNER_FULL);
  });
});
