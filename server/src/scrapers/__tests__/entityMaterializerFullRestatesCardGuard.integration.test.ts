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
import { isFullDescriptionRestatementOfShortDescription } from '../../utils/researchEntityDescriptionQuality';
import { materializeEntity } from '../entityMaterializer';

const STORED_CARD =
  'The group studies how mitochondria are transported along axons and what happens to neurons when that transport fails.';

const FULL_THAT_RESTATES_THE_CARD =
  'The group studies how mitochondria are transported along axons, and what happens to neurons when that transport fails.';

const FULL_THAT_IS_DISTINCT =
  'Work in the group combines live-cell imaging with mouse genetics to map organelle transport, and the team maintains open reconstruction pipelines so collaborators can measure axonal cargo flux in intact tissue preparations.';

const SYNTHESIZED_CARD = 'Synthesized from the retained body.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('materializeEntity keeps the body when the body restates the card (#2721)', () => {
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
      slug: 'full-restates-card-fixture',
      name: 'Axonal Transport Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: STORED_CARD,
      ...overrides,
    });

  const seedFull = async (value: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'full-restates-card-fixture',
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://example.edu/lab-microsite-description-llm/',
      confidence: 0.82,
      observedAt: new Date('2026-08-01T00:00:00Z'),
      superseded: false,
    });
  };

  const materialize = () =>
    materializeEntity(
      'researchEntity',
      { entityKey: 'full-restates-card-fixture' },
      { synthesizeCardDescription: async () => SYNTHESIZED_CARD },
    );

  const persisted = () =>
    ResearchEntity.findOne({ slug: 'full-restates-card-fixture' }).lean<PersistedEntity>();

  it('pins the fixture as a genuine restatement, so the test cannot pass by not triggering the guard', () => {
    expect(
      isFullDescriptionRestatementOfShortDescription(FULL_THAT_RESTATES_THE_CARD, STORED_CARD),
    ).toBe(true);
    expect(isFullDescriptionRestatementOfShortDescription(FULL_THAT_IS_DISTINCT, STORED_CARD)).toBe(
      false,
    );
  });

  it('stores the body rather than blanking it', async () => {
    await seedEntity();
    await seedFull(FULL_THAT_RESTATES_THE_CARD);

    await materialize();

    const row = await persisted();
    expect(row?.fullDescription).toBe(FULL_THAT_RESTATES_THE_CARD);
  });

  it('withholds the current card from card resolution, so the card is never left blank', async () => {
    await seedEntity();
    await seedFull(FULL_THAT_RESTATES_THE_CARD);

    await materialize();

    const row = await persisted();
    // Card resolution may return nothing better than the stored card, in which case the
    // stored one is kept. Either outcome is acceptable; a blank card is not, because that
    // would trade one visibility blocker for another.
    expect([SYNTHESIZED_CARD, STORED_CARD]).toContain(row?.shortDescription);
  });

  it('does not leave the row with a card and no body, which is what blocked it from students', async () => {
    await seedEntity();
    await seedFull(FULL_THAT_RESTATES_THE_CARD);

    await materialize();

    const row = await persisted();
    const hasCard = Boolean((row?.shortDescription ?? '').trim());
    const hasBody = Boolean((row?.fullDescription ?? '').trim());
    expect({ hasCard, hasBody }).toEqual({ hasCard: true, hasBody: true });
  });

  it('leaves a distinct body and its stored card untouched', async () => {
    await seedEntity();
    await seedFull(FULL_THAT_IS_DISTINCT);

    await materialize();

    const row = await persisted();
    expect(row?.fullDescription).toBe(FULL_THAT_IS_DISTINCT);
    expect(row?.shortDescription).toBe(STORED_CARD);
  });
});
