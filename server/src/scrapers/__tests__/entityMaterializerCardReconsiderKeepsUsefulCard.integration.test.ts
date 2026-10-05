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
import { cardLineFitsBrowseCard, isWeakCardLine } from '../../utils/groundedCardSynthesis';
import {
  deriveShortDescriptionFromFullDescription,
  isFullDescriptionRestatementOfShortDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from '../confidenceResolver';
import { materializeEntity } from '../entityMaterializer';

const STORED_USEFUL_CARD =
  "The lab's research focuses on how synaptic plasticity in the hippocampus encodes memory, using electrophysiology and optogenetics to map the circuits involved.";

const SINGLE_SENTENCE_BODY =
  'Research focuses on how synaptic plasticity in the hippocampus encodes memory, using electrophysiology and optogenetics to map the circuits involved.';

const DISTINCT_ONCOLOGY_BODY =
  'The group runs early-phase clinical trials for patients with solid tumors and studies how circulating tumor DNA changes during treatment. It also trains fellows in translational oncology and maintains a biorepository that supports collaborators across the medical school.';

const SCRAPED_CARD_WITH_PARENTHETICAL_EXAMPLE =
  'Clinical research in solid tumors, focusing on early-phase trials and the development of novel therapies (e.g., enzyme inhibitors, immunotherapy) and the tumor DNA dynamics measured in patients during treatment.';

const LONG_LEAD_BODY =
  'The lab investigates how regulatory T cells, T cell anergy, and tolerogenic antigen-presenting cells shape immune responses in cancer, autoimmunity, transplantation, and reproductive health using genetic, biochemical, chemical biology, sequencing, and translational models. Ongoing projects test new ways to restore tolerance in patients.';

const FITTING_SYNTHESIZED_CARD =
  'Investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in cancer and autoimmunity.';

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

  const seedObservation = async (
    field: 'fullDescription' | 'shortDescription',
    value: string,
    sourceName = 'lab-microsite-description-llm',
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: LAB_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.edu/${sourceName}/`,
      confidence: 0.82,
      observedAt: new Date('2026-08-01T00:00:00Z'),
      superseded: false,
    });

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

  it('never cuts a scraped card at "(e.g.", and replaces one too long for the browse card with a line that shows whole (#4809)', async () => {
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
    expect(cardLineFitsBrowseCard(served.servedCard)).toBe(true);
    expect(served.servedCard).not.toBe(SCRAPED_CARD_WITH_PARENTHETICAL_EXAMPLE);
  });

  describe('a stored card the browse card cuts (#4809)', () => {
    const storedCutCard = deriveShortDescriptionFromFullDescription(LONG_LEAD_BODY);
    const materializeCounting = (options: { resynthesizeCutCards?: boolean }) => {
      const synthesizeCardDescription = vi.fn().mockResolvedValue(FITTING_SYNTHESIZED_CARD);
      return {
        synthesizeCardDescription,
        run: () =>
          materializeEntity(
            'researchEntity',
            { entityKey: LAB_KEY },
            { synthesizeCardDescription, ...options },
          ),
      };
    };

    beforeEach(async () => {
      expect(cardLineFitsBrowseCard(storedCutCard)).toBe(false);
      await seedLab(storedCutCard);
      await seedObservation('fullDescription', LONG_LEAD_BODY);
    });

    it('is left alone by a routine materialize, which makes no card synthesis call', async () => {
      const { synthesizeCardDescription, run } = materializeCounting({});

      await run();

      expect(synthesizeCardDescription).not.toHaveBeenCalled();
      expect((await persisted())?.shortDescription).toBe(storedCutCard);
    });

    it('is replaced by a synthesized line that fits when resynthesis is asked for', async () => {
      const { synthesizeCardDescription, run } = materializeCounting({
        resynthesizeCutCards: true,
      });

      await run();

      expect(synthesizeCardDescription).toHaveBeenCalled();
      const stored = (await persisted())?.shortDescription;
      expect(stored).toBe(FITTING_SYNTHESIZED_CARD);
      expect(cardLineFitsBrowseCard(stored)).toBe(true);
    });
  });

  describe('a written body whose stored card fits but names what the body does not (#4809)', () => {
    const storedUngroundedCard =
      'Investigates how regulatory T cells and tolerogenic antigen-presenting cells shape immune responses in pediatric melanoma and lupus.';
    const servedCard = async () =>
      buildResearchEntityPublicDescriptionRepresentation({ entity: (await persisted()) ?? {} })
        .servedCard;

    beforeEach(async () => {
      expect(cardLineFitsBrowseCard(storedUngroundedCard)).toBe(true);
      const body = await seedObservation(
        'fullDescription',
        LONG_LEAD_BODY,
        WRITTEN_DESCRIPTION_SOURCE_NAME,
      );
      await ResearchEntity.create({
        slug: LAB_KEY,
        name: 'Synthetic Plasticity Lab',
        kind: 'lab',
        studentVisibilityTier: 'operator_review',
        archived: false,
        shortDescription: storedUngroundedCard,
        fullDescription: LONG_LEAD_BODY,
        fieldProvenance: {
          fullDescription: {
            observationId: body._id,
            sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
          },
        },
      });
    });

    it('is left alone by a routine materialize, which makes no card synthesis call, though the serve chain surrenders it', async () => {
      const synthesizeCardDescription = vi.fn().mockResolvedValue(FITTING_SYNTHESIZED_CARD);

      await materializeEntity(
        'researchEntity',
        { entityKey: LAB_KEY },
        { synthesizeCardDescription },
      );

      recordEvidence('fitting ungrounded card after a routine materialize', await persisted());
      expect(synthesizeCardDescription).not.toHaveBeenCalled();
      expect((await persisted())?.shortDescription).toBe(storedUngroundedCard);
      expect(await servedCard()).not.toBe(storedUngroundedCard);
    });

    it('is replaced by a synthesized line the browse card shows whole when resynthesis is asked for', async () => {
      const synthesizeCardDescription = vi.fn().mockResolvedValue(FITTING_SYNTHESIZED_CARD);

      await materializeEntity(
        'researchEntity',
        { entityKey: LAB_KEY },
        { synthesizeCardDescription, resynthesizeCutCards: true },
      );

      recordEvidence('fitting ungrounded card resynthesized', await persisted());
      expect(synthesizeCardDescription).toHaveBeenCalled();
      expect((await persisted())?.shortDescription).toBe(FITTING_SYNTHESIZED_CARD);
      expect(await servedCard()).toBe(FITTING_SYNTHESIZED_CARD);
    });
  });

  describe('a written body whose stored card shows whole (#4809)', () => {
    beforeEach(async () => {
      const body = await seedObservation(
        'fullDescription',
        LONG_LEAD_BODY,
        WRITTEN_DESCRIPTION_SOURCE_NAME,
      );
      await ResearchEntity.create({
        slug: LAB_KEY,
        name: 'Synthetic Plasticity Lab',
        kind: 'lab',
        studentVisibilityTier: 'operator_review',
        archived: false,
        shortDescription: FITTING_SYNTHESIZED_CARD,
        fullDescription: LONG_LEAD_BODY,
        fieldProvenance: {
          fullDescription: {
            observationId: body._id,
            sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
          },
        },
      });
    });

    it('is kept without a card synthesis call even when resynthesis is asked for', async () => {
      const synthesizeCardDescription = vi.fn().mockResolvedValue('Studies immune tolerance.');

      await materializeEntity(
        'researchEntity',
        { entityKey: LAB_KEY },
        { synthesizeCardDescription, resynthesizeCutCards: true },
      );

      expect(synthesizeCardDescription).not.toHaveBeenCalled();
      expect((await persisted())?.shortDescription).toBe(FITTING_SYNTHESIZED_CARD);
    });
  });

  describe('a weak card on a row whose card does not follow the written body (#4809)', () => {
    const storedWeakCard = 'Studies immune tolerance.';

    beforeEach(async () => {
      expect(isWeakCardLine(storedWeakCard, {})).toBe(true);
      await seedLab(storedWeakCard);
      await seedObservation('fullDescription', LONG_LEAD_BODY);
    });

    it('is left alone by the weak-card flag, which makes no card synthesis call', async () => {
      const synthesizeCardDescription = vi.fn().mockResolvedValue(FITTING_SYNTHESIZED_CARD);

      await materializeEntity(
        'researchEntity',
        { entityKey: LAB_KEY },
        { synthesizeCardDescription, resynthesizeWeakCards: true },
      );

      expect(synthesizeCardDescription).not.toHaveBeenCalled();
      expect((await persisted())?.shortDescription).toBe(storedWeakCard);
    });
  });
});
