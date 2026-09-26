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
import { isCareerBiographyDescription } from '../../utils/careerBiographyDescription';
import {
  fullDescriptionQuality,
  isFullDescriptionRestatementOfShortDescription,
  isPoorerThanCardDescription,
} from '../../utils/researchEntityDescriptionQuality';
import { materializeEntity } from '../entityMaterializer';

const RESEARCH_CARD =
  'Studies documentary and experimental film, early Soviet culture and its later reception, and the comparative study of the short story form.';

// Carries a research-interests sentence after the career facts, which is what the
// corpus shape does and what keeps it off the `appointment-only` quality flag: an
// appointment-only bio is already refused, so a fixture without that sentence would
// pass the test without ever reaching the walk.
const CAREER_BIOGRAPHY =
  'Robin Quill is Professor of Film and Media Studies and Chair of Slavic Languages and Literatures at a university in New England. Quill completed a BA in English in 1987 and a PhD in Comparative Literature in 1998, and teaches a wide variety of courses on literature, cultural theory, and moving image media. Quill was appointed to an endowed chair in 2012 and has served as Deputy Dean. Quill’s current research interests include documentary and experimental film, early Soviet culture and its later reception, and the comparative study of the short story form.';

const SYNTHESIS_RESTATING_THE_CARD =
  'Research on documentary and experimental film, early Soviet culture and its later reception, and the comparative study of the short story form.';

const RICH_RESEARCH_CARD =
  'An applied economic theorist, Quill studies how firms compete in data-rich digital markets, using analytical models and game theory to examine pricing, targeting, and information design, with a focus on how consumers interpret firm actions.';

const SYNTHESIS_THINNER_THAN_THE_CARD =
  'Research examines firms strategic decisions in advertising, pricing, and customer relationship management using applied economic theory and digital strategy.';

const RESTATEMENT_KEY = 'bio-loses-to-restating-synthesis-fixture';
const THINNER_KEY = 'bio-loses-to-thinner-synthesis-fixture';

type PersistedEntity = {
  fullDescription?: string;
  shortDescription?: string;
};

describe('a career biography never wins a full/card pair rejection (#2901)', () => {
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

  const seedRow = async (slug: string, card: string = RESEARCH_CARD) =>
    ResearchEntity.create({
      slug,
      name: 'Robin Quill Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
      shortDescription: card,
      fullDescription: CAREER_BIOGRAPHY,
    });

  const seedObservation = async (input: {
    entityKey: string;
    value: string;
    sourceName: string;
    confidence: number;
    observedAt: string;
  }) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: input.entityKey,
      field: 'fullDescription',
      value: input.value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: input.sourceName,
      sourceUrl: 'https://filmstudies.example.edu/people/robin-quill',
      confidence: input.confidence,
      observedAt: new Date(input.observedAt),
      superseded: false,
    });
  };

  const seedPair = async (slug: string, synthesisValue: string, card: string = RESEARCH_CARD) => {
    await seedRow(slug, card);
    await seedObservation({
      entityKey: slug,
      value: CAREER_BIOGRAPHY,
      sourceName: 'lab-microsite-description-llm',
      confidence: 0.82,
      observedAt: '2026-09-14T00:00:00Z',
    });
    await seedObservation({
      entityKey: slug,
      value: synthesisValue,
      sourceName: 'fra-profile-research-synthesis',
      confidence: 0.48,
      observedAt: '2026-09-22T00:00:00Z',
    });
  };

  const persisted = (slug: string) => ResearchEntity.findOne({ slug }).lean<PersistedEntity>();

  it('pins the fixtures, so neither case can pass by never reaching the pair rejection', () => {
    expect(isCareerBiographyDescription(CAREER_BIOGRAPHY)).toBe(true);
    expect(fullDescriptionQuality(CAREER_BIOGRAPHY).isUseful).toBe(true);

    // The biography satisfies both pair tests by construction, which is why it was
    // the value the fallback walk selected.
    expect(isFullDescriptionRestatementOfShortDescription(CAREER_BIOGRAPHY, RESEARCH_CARD)).toBe(
      false,
    );
    expect(isPoorerThanCardDescription(CAREER_BIOGRAPHY, RESEARCH_CARD)).toBe(false);

    expect(
      isFullDescriptionRestatementOfShortDescription(SYNTHESIS_RESTATING_THE_CARD, RESEARCH_CARD),
    ).toBe(true);
    expect(isCareerBiographyDescription(SYNTHESIS_RESTATING_THE_CARD)).toBe(false);

    expect(isPoorerThanCardDescription(SYNTHESIS_THINNER_THAN_THE_CARD, RICH_RESEARCH_CARD)).toBe(
      true,
    );
    expect(fullDescriptionQuality(SYNTHESIS_THINNER_THAN_THE_CARD).isUseful).toBe(true);
    expect(isPoorerThanCardDescription(CAREER_BIOGRAPHY, RICH_RESEARCH_CARD)).toBe(false);
    expect(isCareerBiographyDescription(SYNTHESIS_THINNER_THAN_THE_CARD)).toBe(false);
  });

  it('keeps the research body when the replacement restates the card', async () => {
    await seedPair(RESTATEMENT_KEY, SYNTHESIS_RESTATING_THE_CARD);

    await materializeEntity(
      'researchEntity',
      { entityKey: RESTATEMENT_KEY },
      { synthesizeCardDescription: async () => '' },
    );

    const row = await persisted(RESTATEMENT_KEY);
    expect(row?.fullDescription).toBe(SYNTHESIS_RESTATING_THE_CARD);
    expect(row?.fullDescription).not.toBe(CAREER_BIOGRAPHY);
  });

  it('keeps the research body when the replacement is thinner than the card', async () => {
    await seedPair(THINNER_KEY, SYNTHESIS_THINNER_THAN_THE_CARD, RICH_RESEARCH_CARD);

    await materializeEntity(
      'researchEntity',
      { entityKey: THINNER_KEY },
      { synthesizeCardDescription: async () => '' },
    );

    const row = await persisted(THINNER_KEY);
    expect(row?.fullDescription).toBe(SYNTHESIS_THINNER_THAN_THE_CARD);
    expect(row?.fullDescription).not.toBe(CAREER_BIOGRAPHY);
  });

  it('never leaves the row with a card and no body', async () => {
    await seedPair(RESTATEMENT_KEY, SYNTHESIS_RESTATING_THE_CARD);

    await materializeEntity(
      'researchEntity',
      { entityKey: RESTATEMENT_KEY },
      { synthesizeCardDescription: async () => '' },
    );

    const row = await persisted(RESTATEMENT_KEY);
    expect(Boolean((row?.fullDescription ?? '').trim())).toBe(true);
    expect(Boolean((row?.shortDescription ?? '').trim())).toBe(true);
  });

  it('still serves a sole biography, because refusing it in the walk must not blank a row', async () => {
    const soleBioKey = 'sole-biography-fixture';
    await seedRow(soleBioKey);
    await seedObservation({
      entityKey: soleBioKey,
      value: CAREER_BIOGRAPHY,
      sourceName: 'lab-microsite-description-llm',
      confidence: 0.82,
      observedAt: '2026-09-14T00:00:00Z',
    });

    await materializeEntity(
      'researchEntity',
      { entityKey: soleBioKey },
      { synthesizeCardDescription: async () => '' },
    );

    const row = await persisted(soleBioKey);
    expect(row?.fullDescription).toBe(CAREER_BIOGRAPHY);
  });
});
