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
import {
  buildResearchAreasCardSummary,
  isFullDescriptionRestatementOfShortDescription,
} from '../../utils/researchEntityDescriptionQuality';
import { materializeEntity } from '../entityMaterializer';

const STORED_CARD =
  'The group studies how mitochondria are transported along axons and what happens to neurons when that transport fails.';

const FULL_THAT_RESTATES_THE_CARD =
  'The group studies how mitochondria are transported along axons, and what happens to neurons when that transport fails.';

const FULL_THAT_IS_DISTINCT =
  'Work in the group combines live-cell imaging with mouse genetics to map organelle transport, and the team maintains open reconstruction pipelines so collaborators can measure axonal cargo flux in intact tissue preparations.';

const SYNTHESIZED_CARD =
  'Maps how mitochondrial cargo moves through living axons and why that traffic stalls in disease.';

const RESEARCH_AREAS = [
  'axonal transport',
  'mitochondrial biology',
  'neurodegeneration',
  'cell biology',
];

const PROGRAM_FULL_IN_ONE_SENTENCE =
  'The fellowship funds a ten-week summer research placement for Yale undergraduates in a host laboratory, and covers a stipend plus housing.';

const LAB_KEY = 'full-restates-card-fixture';
const PROGRAM_KEY = 'program-card-derived-from-body-fixture';

type PersistedEntity = {
  fullDescription?: string;
  shortDescription?: string;
  kind?: string;
};

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

  const seedLab = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: LAB_KEY,
      name: 'Axonal Transport Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: STORED_CARD,
      ...overrides,
    });

  // `kind` is otherwise derived from `entityType`, and no entityType maps back to
  // 'program' (#2144), so locking it is the only way a stored program-like kind
  // survives a materialize and reaches the program-only blanking branch.
  const seedProgram = async () =>
    ResearchEntity.create({
      slug: PROGRAM_KEY,
      name: 'Summer Undergraduate Research Fellowship',
      kind: 'program',
      manuallyLockedFields: ['kind'],
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: '',
    });

  const seedFull = async (entityKey: string, value: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
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

  const materialize = (entityKey: string, synthesized = SYNTHESIZED_CARD) =>
    materializeEntity(
      'researchEntity',
      { entityKey },
      { synthesizeCardDescription: async () => synthesized },
    );

  const persisted = (entityKey: string) =>
    ResearchEntity.findOne({ slug: entityKey }).lean<PersistedEntity>();

  it('pins the fixture as a genuine restatement, so the test cannot pass by not triggering the guard', () => {
    expect(
      isFullDescriptionRestatementOfShortDescription(FULL_THAT_RESTATES_THE_CARD, STORED_CARD),
    ).toBe(true);
    expect(isFullDescriptionRestatementOfShortDescription(FULL_THAT_IS_DISTINCT, STORED_CARD)).toBe(
      false,
    );
  });

  it('stores the body rather than blanking it', async () => {
    await seedLab();
    await seedFull(LAB_KEY, FULL_THAT_RESTATES_THE_CARD);

    await materialize(LAB_KEY);

    const row = await persisted(LAB_KEY);
    expect(row?.fullDescription).toBe(FULL_THAT_RESTATES_THE_CARD);
  });

  it('replaces the restated card with a card grounded in the retained body', async () => {
    await seedLab();
    await seedFull(LAB_KEY, FULL_THAT_RESTATES_THE_CARD);

    await materialize(LAB_KEY);

    const row = await persisted(LAB_KEY);
    expect(row?.shortDescription).toBe(SYNTHESIZED_CARD);
    expect(row?.fullDescription).toBe(FULL_THAT_RESTATES_THE_CARD);
  });

  it('keeps the restated card rather than trading it for a bare research-areas echo', async () => {
    await seedLab({ researchAreas: RESEARCH_AREAS });
    await seedFull(LAB_KEY, FULL_THAT_RESTATES_THE_CARD);

    await materialize(LAB_KEY, '');

    const row = await persisted(LAB_KEY);
    expect(row?.shortDescription).not.toBe(buildResearchAreasCardSummary(RESEARCH_AREAS));
    expect(row?.shortDescription).toBe(STORED_CARD);
    expect(row?.fullDescription).toBe(FULL_THAT_RESTATES_THE_CARD);
  });

  it('does not leave the row with a card and no body, which is what blocked it from students', async () => {
    await seedLab();
    await seedFull(LAB_KEY, FULL_THAT_RESTATES_THE_CARD);

    await materialize(LAB_KEY);

    const row = await persisted(LAB_KEY);
    const hasCard = Boolean((row?.shortDescription ?? '').trim());
    const hasBody = Boolean((row?.fullDescription ?? '').trim());
    expect({ hasCard, hasBody }).toEqual({ hasCard: true, hasBody: true });
  });

  it('keeps a program body that the card it just derived from that body restates', async () => {
    await seedProgram();
    await seedFull(PROGRAM_KEY, PROGRAM_FULL_IN_ONE_SENTENCE);

    await materialize(PROGRAM_KEY);

    const row = await persisted(PROGRAM_KEY);
    expect(row?.kind).toBe('program');
    expect(row?.shortDescription).toBe(PROGRAM_FULL_IN_ONE_SENTENCE);
    expect(row?.fullDescription).toBe(PROGRAM_FULL_IN_ONE_SENTENCE);
  });

  it('leaves a distinct body and its stored card untouched', async () => {
    await seedLab();
    await seedFull(LAB_KEY, FULL_THAT_IS_DISTINCT);

    await materialize(LAB_KEY);

    const row = await persisted(LAB_KEY);
    expect(row?.fullDescription).toBe(FULL_THAT_IS_DISTINCT);
    expect(row?.shortDescription).toBe(STORED_CARD);
  });
});
