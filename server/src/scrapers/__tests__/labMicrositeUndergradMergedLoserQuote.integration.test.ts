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
import { materializeEntity } from '../entityMaterializer';
import {
  defaultLiveEvidenceQuoteLoader,
  evidenceQuoteWithdrawalObservation,
} from '../sources/labMicrositeUndergradLLMExtractor';

const LANE = 'lab-microsite-undergrad-llm';
const SURVIVOR_SLUG = 'synthetic-survivor-research';
const FIRST_HOP_SLUG = 'synthetic-first-hop-lab';
const SECOND_HOP_SLUG = 'synthetic-second-hop-lab';
const CENTER_PAGE = 'https://synthetic.yale.edu/center/profile/synthetic-member/';
const STALE_QUOTE = 'The center offers a summer internship for college undergraduates.';
const OWN_QUOTE = 'Undergraduates join the lab every fall.';
const NEWER_LOSER_QUOTE = 'Undergraduates may apply for a research assistant role.';

describe("a re-read reaches a survivor's quote whose evidence sits on a merged-in row (#3831)", () => {
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

  const seedQuoteObservation = async (
    identity: { entityKey: string; entityId?: mongoose.Types.ObjectId },
    value: string,
    observedAt: string,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      ...identity,
      field: 'undergradEvidenceQuote',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: LANE,
      sourceUrl: CENTER_PAGE,
      confidence: 0.5,
      observedAt: new Date(observedAt),
      superseded: false,
    });

  const seedTwoHopMerge = async () => {
    const survivor = await ResearchEntity.create({
      slug: SURVIVOR_SLUG,
      name: 'Synthetic Survivor Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [CENTER_PAGE],
    });
    const firstHop = await ResearchEntity.create({
      slug: FIRST_HOP_SLUG,
      name: 'Synthetic First Hop Lab',
      kind: 'lab',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    const secondHop = await ResearchEntity.create({
      slug: SECOND_HOP_SLUG,
      name: 'Synthetic Second Hop Lab',
      kind: 'lab',
      archived: true,
      canonicalGroupId: firstHop._id,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SURVIVOR_SLUG,
      field: 'name',
      value: 'Synthetic Survivor Research',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-atoz-index',
      sourceUrl: CENTER_PAGE,
      confidence: 0.8,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });
    return { survivor, secondHop };
  };

  const backStoredQuoteWith = async (
    survivorId: mongoose.Types.ObjectId,
    observationId: mongoose.Types.ObjectId,
  ) =>
    ResearchEntity.updateOne(
      { _id: survivorId },
      {
        $set: {
          undergradEvidenceQuote: STALE_QUOTE,
          'fieldProvenance.undergradEvidenceQuote': {
            sourceName: LANE,
            observationId,
            sourceUrl: CENTER_PAGE,
            observedAt: new Date('2026-08-28T00:00:00Z'),
            confidence: 0.5,
          },
        },
      },
    );

  const storedQuote = async (id: mongoose.Types.ObjectId) =>
    (await ResearchEntity.findById(id).lean<{ undergradEvidenceQuote?: string }>())
      ?.undergradEvidenceQuote ?? '';

  it('loads a quote keyed to a row merged in two hops away', async () => {
    const { survivor } = await seedTwoHopMerge();
    const loserQuote = await seedQuoteObservation(
      { entityKey: SECOND_HOP_SLUG },
      STALE_QUOTE,
      '2026-08-28T00:00:00Z',
    );
    await backStoredQuoteWith(survivor._id, loserQuote._id);

    expect(await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG)).toEqual({
      value: STALE_QUOTE,
      sourceUrl: CENTER_PAGE,
    });
  });

  it('loads a merged-in quote recorded under the entityId identity form', async () => {
    const { survivor, secondHop } = await seedTwoHopMerge();
    const loserQuote = await seedQuoteObservation(
      { entityKey: 'synthetic-unrelated-key', entityId: secondHop._id },
      STALE_QUOTE,
      '2026-08-28T00:00:00Z',
    );
    await backStoredQuoteWith(survivor._id, loserQuote._id);

    expect((await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG))?.value).toBe(STALE_QUOTE);
  });

  it('loads the merged-in quote the stored provenance names, not the newest one', async () => {
    const { survivor } = await seedTwoHopMerge();
    const backingQuote = await seedQuoteObservation(
      { entityKey: SECOND_HOP_SLUG },
      STALE_QUOTE,
      '2026-08-28T00:00:00Z',
    );
    await seedQuoteObservation(
      { entityKey: FIRST_HOP_SLUG },
      NEWER_LOSER_QUOTE,
      '2026-09-20T00:00:00Z',
    );
    await backStoredQuoteWith(survivor._id, backingQuote._id);

    expect((await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG))?.value).toBe(STALE_QUOTE);
  });

  it('loads no merged-in quote when the stored quote names no provenance', async () => {
    await seedTwoHopMerge();
    await seedQuoteObservation({ entityKey: SECOND_HOP_SLUG }, STALE_QUOTE, '2026-08-28T00:00:00Z');

    expect(await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG)).toBeNull();
  });

  it('loads no quote whose provenance names an observation on a row outside the merge', async () => {
    const { survivor } = await seedTwoHopMerge();
    const foreignQuote = await seedQuoteObservation(
      { entityKey: SECOND_HOP_SLUG, entityId: new mongoose.Types.ObjectId() },
      STALE_QUOTE,
      '2026-08-28T00:00:00Z',
    );
    await backStoredQuoteWith(survivor._id, foreignQuote._id);

    expect(await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG)).toBeNull();
  });

  it("prefers the survivor's own quote over a newer merged-in one", async () => {
    await seedTwoHopMerge();
    await seedQuoteObservation({ entityKey: SURVIVOR_SLUG }, OWN_QUOTE, '2026-09-01T00:00:00Z');
    await seedQuoteObservation({ entityKey: SECOND_HOP_SLUG }, STALE_QUOTE, '2026-09-20T00:00:00Z');

    expect((await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG))?.value).toBe(OWN_QUOTE);
  });

  it('clears the served quote once the survivor withdraws the merged-in evidence', async () => {
    const { survivor } = await seedTwoHopMerge();
    const loserQuote = await seedQuoteObservation(
      { entityKey: SECOND_HOP_SLUG },
      STALE_QUOTE,
      '2026-08-28T00:00:00Z',
    );
    await backStoredQuoteWith(survivor._id, loserQuote._id);

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });
    expect(await storedQuote(survivor._id)).toBe(STALE_QUOTE);

    const live = await defaultLiveEvidenceQuoteLoader(SURVIVOR_SLUG);
    if (!live) throw new Error('the merged-in quote was not loaded');
    const { confidenceOverride, ...withdrawal } = evidenceQuoteWithdrawalObservation(
      SURVIVOR_SLUG,
      live,
    );
    await Observation.create({
      ...withdrawal,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: LANE,
      confidence: confidenceOverride,
      observedAt: new Date('2026-09-28T00:00:00Z'),
      superseded: false,
    });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });
    expect(await storedQuote(survivor._id)).toBe('');

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });
    expect(await storedQuote(survivor._id)).toBe('');
  });
});
