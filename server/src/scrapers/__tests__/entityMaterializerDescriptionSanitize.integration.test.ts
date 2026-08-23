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

const CLEAN_FULL =
  'Our interdisciplinary research program brings together computational biologists, clinicians, and data scientists who study how immune cell populations respond to cancer immunotherapy across many tumor types, integrating single-cell RNA sequencing, spatial proteomics, and machine learning to identify predictive biomarkers of treatment response in patients over long clinical follow-up windows.';

const CHROME_PREFIX = 'Skip to main content Show all breadcrumbs Toggle navigation ';

const DIRTY_CHROME_FULL = CHROME_PREFIX + CLEAN_FULL;

const ROSTER_FULL =
  "Jane Doe '27 Mentor: Professor Alpha. John Smith '26 Mentor: Professor Beta. Mary Lee '28 Mentor: Professor Gamma. Alex Ray '25 Mentor: Professor Delta.";

const GROUNDED_CARD =
  'Studies how immune cell populations respond to cancer immunotherapy using single-cell RNA sequencing and machine learning.';

const GROUP_PROSE_LAB_FULL =
  'The Kang Laboratory is dedicated to understanding the fundamental mechanisms that govern how epithelial tissues maintain their architecture and regenerate after injury, bringing together cell biologists, geneticists, and computational modelers who combine live-imaging, single-cell sequencing, and organoid systems to dissect the signaling circuits that coordinate collective cell behavior across developing and adult tissues.';

const GROUP_PROSE_CARD =
  'Studies how epithelial tissues maintain their architecture and regenerate after injury using live-imaging, single-cell sequencing, and organoid systems.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('materializeEntity sanitizes description text at the write step (#670/#671, #682 grounding)', () => {
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
      slug: 'desc-sanitize-fixture',
      name: 'Immunotherapy Research Home',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...overrides,
    });

  const seedFullDescription = async (value: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'desc-sanitize-fixture',
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description',
      sourceUrl: 'https://example.edu/lab/immunotherapy/',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  const capturingSynthesizer =
    (calls: string[], card: string = GROUNDED_CARD) =>
    (fullDescription: string) => {
      calls.push(fullDescription);
      return synthesizeGroundedCardDescription({
        fullDescription,
        entityName: 'Immunotherapy Research Home',
        callLLM: async () => card,
      });
    };

  it('strips page chrome from the winning observation before writing and grounds synthesis on the clean text', async () => {
    await seedEntity();
    await seedFullDescription(DIRTY_CHROME_FULL);

    const calls: string[] = [];
    await materializeEntity(
      'researchEntity',
      { entityKey: 'desc-sanitize-fixture' },
      { synthesizeCardDescription: capturingSynthesizer(calls) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'desc-sanitize-fixture' }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(CLEAN_FULL);
    expect(persisted?.fullDescription).not.toContain('breadcrumbs');
    expect(persisted?.fullDescription).not.toContain('Skip to main content');
    expect(calls).toEqual([CLEAN_FULL]);
    expect(persisted?.shortDescription).toBe(GROUNDED_CARD);
  });

  it('fails closed to an empty description on roster/PII-shaped source text and does not synthesize', async () => {
    await seedEntity();
    await seedFullDescription(ROSTER_FULL);

    const calls: string[] = [];
    await materializeEntity(
      'researchEntity',
      { entityKey: 'desc-sanitize-fixture' },
      { synthesizeCardDescription: capturingSynthesizer(calls) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'desc-sanitize-fixture' }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe('');
    expect(calls).toHaveLength(0);
    expect(persisted?.shortDescription ?? '').toBe('');
  });

  it('writes genuine clean prose verbatim so hygiene does not mangle a valid description', async () => {
    await seedEntity();
    await seedFullDescription(CLEAN_FULL);

    const calls: string[] = [];
    await materializeEntity(
      'researchEntity',
      { entityKey: 'desc-sanitize-fixture' },
      { synthesizeCardDescription: capturingSynthesizer(calls) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'desc-sanitize-fixture' }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(CLEAN_FULL);
    expect(calls).toEqual([CLEAN_FULL]);
    expect(persisted?.shortDescription).toBe(GROUNDED_CARD);
  });

  it('keeps legitimate group-prose lab descriptions (no bio-gate false-empty) and grounds synthesis on them', async () => {
    await seedEntity({ name: 'Kang Laboratory' });
    await seedFullDescription(GROUP_PROSE_LAB_FULL);

    const calls: string[] = [];
    await materializeEntity(
      'researchEntity',
      { entityKey: 'desc-sanitize-fixture' },
      { synthesizeCardDescription: capturingSynthesizer(calls, GROUP_PROSE_CARD) },
    );

    const persisted = await ResearchEntity.findOne({ slug: 'desc-sanitize-fixture' }).lean<PersistedEntity>();

    expect(persisted?.fullDescription).toBe(GROUP_PROSE_LAB_FULL);
    expect(calls).toEqual([GROUP_PROSE_LAB_FULL]);
    expect(persisted?.shortDescription).toBe(GROUP_PROSE_CARD);
  });
});
