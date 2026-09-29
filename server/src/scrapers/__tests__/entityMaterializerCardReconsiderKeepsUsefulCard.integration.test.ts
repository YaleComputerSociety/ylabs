import { appendFileSync } from 'node:fs';
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
import { buildResearchEntityPublicDescriptionRepresentation } from '../../services/researchEntityPublicDescription';
import { researchEntityDescriptionIsCoherent } from '../../services/studentVisibilityTier';
import { MAX_SHORT_DESCRIPTION_LENGTH } from '../../utils/descriptionHygiene';
import {
  deriveShortDescriptionFromFullDescription,
  isFullDescriptionRestatementOfShortDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { materializeEntity } from '../entityMaterializer';

const STORED_USEFUL_CARD =
  "The lab's research focuses on how synaptic plasticity in the hippocampus encodes memory, using electrophysiology and optogenetics to map the circuits involved.";

const SINGLE_SENTENCE_BODY =
  'Research focuses on how synaptic plasticity in the hippocampus encodes memory, using electrophysiology and optogenetics to map the circuits involved.';

const DISTINCT_ONCOLOGY_BODY =
  'The group runs early-phase clinical trials for patients with solid tumors and studies how circulating tumor DNA changes during treatment. It also trains fellows in translational oncology and maintains a biorepository that supports collaborators across the medical school.';

const SCRAPED_CARD_WITH_PARENTHETICAL_EXAMPLE =
  'Clinical research in solid tumors, focusing on early-phase trials and the development of novel therapies (e.g., enzyme inhibitors, immunotherapy) and the tumor DNA dynamics measured in patients during treatment.';

const LAB_KEY = 'card-reconsider-keeps-useful-card-fixture';

type PersistedEntity = Record<string, unknown> & {
  fullDescription?: string;
  shortDescription?: string;
};

describe('materializeEntity card reconsideration and the e.g. clamp (#3866)', () => {
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
  });

  const seedLab = async (shortDescription: string) =>
    ResearchEntity.create({
      slug: LAB_KEY,
      name: 'Synthetic Plasticity Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription,
    });

  const seedObservation = async (field: 'fullDescription' | 'shortDescription', value: string) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: LAB_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://example.edu/lab-microsite-description-llm/',
      confidence: 0.82,
      observedAt: new Date('2026-08-01T00:00:00Z'),
      superseded: false,
    });
  };

  const materializeWith = (synthesized: string) =>
    materializeEntity(
      'researchEntity',
      { entityKey: LAB_KEY },
      { synthesizeCardDescription: async () => synthesized },
    );

  const persisted = () => ResearchEntity.findOne({ slug: LAB_KEY }).lean<PersistedEntity>();

  const recordEvidence = (scenario: string, row: PersistedEntity | null) => {
    const out = process.env.NM_3866_EVIDENCE;
    if (!out || !row) return;
    const served = buildResearchEntityPublicDescriptionRepresentation({ entity: row });
    appendFileSync(
      out,
      `${JSON.stringify(
        {
          scenario,
          storedShortDescription: row.shortDescription,
          storedFullDescription: row.fullDescription,
          servedCard: served.servedCard,
          descriptionCoherent: researchEntityDescriptionIsCoherent(row),
        },
        null,
        2,
      )}\n`,
    );
  };

  it('pins the fixture: the body restates a card that clears the bar, and derives itself as its card', () => {
    expect(
      isFullDescriptionRestatementOfShortDescription(SINGLE_SENTENCE_BODY, STORED_USEFUL_CARD),
    ).toBe(true);
    expect(shortDescriptionQuality(STORED_USEFUL_CARD, SINGLE_SENTENCE_BODY).isUseful).toBe(true);
    expect(deriveShortDescriptionFromFullDescription(SINGLE_SENTENCE_BODY)).toBe(
      SINGLE_SENTENCE_BODY,
    );
  });

  it('keeps the stored useful card instead of replacing it with the single-sentence body', async () => {
    await seedLab(STORED_USEFUL_CARD);
    await seedObservation('fullDescription', SINGLE_SENTENCE_BODY);

    await materializeWith('');

    const row = await persisted();
    recordEvidence('reconsideration keeps a useful card', row);
    expect(row?.fullDescription).toBe(SINGLE_SENTENCE_BODY);
    expect(row?.shortDescription).toBe(STORED_USEFUL_CARD);
    expect(researchEntityDescriptionIsCoherent(row as Record<string, unknown>)).toBe(true);
  });

  it('serves a scraped card with a parenthetical e.g. whole, never cut at "(e.g."', async () => {
    expect(SCRAPED_CARD_WITH_PARENTHETICAL_EXAMPLE.length).toBeGreaterThan(
      MAX_SHORT_DESCRIPTION_LENGTH,
    );
    await seedLab('');
    await seedObservation('fullDescription', DISTINCT_ONCOLOGY_BODY);
    await seedObservation('shortDescription', SCRAPED_CARD_WITH_PARENTHETICAL_EXAMPLE);

    await materializeWith('');

    const row = await persisted();
    recordEvidence('scraped e.g. card is not clamped mid-parenthetical', row);
    const served = buildResearchEntityPublicDescriptionRepresentation({ entity: row ?? {} });
    for (const card of [row?.shortDescription ?? '', served.servedCard]) {
      expect(card).not.toMatch(/\((?:e\.g|i\.e)\.\s*$/i);
    }
    expect(served.servedCard).toBe(SCRAPED_CARD_WITH_PARENTHETICAL_EXAMPLE);
  });
});
