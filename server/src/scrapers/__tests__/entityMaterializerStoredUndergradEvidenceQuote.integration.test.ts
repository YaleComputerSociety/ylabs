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

const SLUG = 'synthetic-quote-lab';
const LAB_URL = 'https://synthetic-quote-lab.example.edu/';
const LANE = 'lab-microsite-undergrad-llm';
const SEARCH_NOTE = 'No explicit mention of undergraduates was found on the provided pages.';
const PARAPHRASE = 'The lab regularly hosts Yale undergraduates in its research projects.';
const GROUNDED = 'Undergraduates join the lab every fall.';

describe('a stored undergradEvidenceQuote the evidence no longer backs clears on materialize (#3592)', () => {
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

  const seedObservation = async (
    field: string,
    value: unknown,
    sourceName: string,
    observedAt: string,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: LAB_URL,
      confidence: 0.5,
      observedAt: new Date(observedAt),
      superseded: false,
    });

  const seedRow = async (quote: string, fields: Record<string, unknown> = {}) => {
    const row = await ResearchEntity.create({
      slug: SLUG,
      name: 'Synthetic Quote Lab',
      kind: 'group',
      entityType: 'LAB',
      archived: false,
      websiteUrl: LAB_URL,
      sourceUrls: [LAB_URL],
      undergradEvidenceQuote: quote,
      fieldProvenance: {
        undergradEvidenceQuote: {
          sourceName: LANE,
          sourceUrl: LAB_URL,
          observedAt: new Date('2026-09-01T00:00:00Z'),
          confidence: 0.5,
        },
      },
      ...fields,
    });
    await seedObservation('name', 'Synthetic Quote Lab', 'ysm-atoz-index', '2026-09-01T00:00:00Z');
    return row;
  };

  const storedQuote = async (id: mongoose.Types.ObjectId) =>
    (await ResearchEntity.findById(id).lean<{ undergradEvidenceQuote?: string }>())
      ?.undergradEvidenceQuote ?? '';

  it('clears a stored model search note, and stays cleared on a second pass', async () => {
    const row = await seedRow(SEARCH_NOTE);
    await seedObservation('undergradEvidenceQuote', SEARCH_NOTE, LANE, '2026-09-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(await storedQuote(row._id)).toBe('');

    await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(await storedQuote(row._id)).toBe('');
  });

  it('clears a stored quote once its lane states the page no longer carries it', async () => {
    const row = await seedRow(PARAPHRASE);
    await seedObservation('undergradEvidenceQuote', PARAPHRASE, LANE, '2026-09-01T00:00:00Z');
    await seedObservation('undergradEvidenceQuote', '', LANE, '2026-09-27T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedQuote(row._id)).toBe('');
  });

  it('keeps a stored quote its lane still asserts', async () => {
    const row = await seedRow(GROUNDED);
    await seedObservation('undergradEvidenceQuote', GROUNDED, LANE, '2026-09-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedQuote(row._id)).toBe(GROUNDED);
  });

  it('keeps a stored quote that no source has withdrawn, even with no live observation', async () => {
    const row = await seedRow(GROUNDED);

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedQuote(row._id)).toBe(GROUNDED);
  });

  it('falls back to another source that still asserts a quote', async () => {
    const row = await seedRow(PARAPHRASE);
    await seedObservation('undergradEvidenceQuote', PARAPHRASE, LANE, '2026-09-01T00:00:00Z');
    await seedObservation('undergradEvidenceQuote', '', LANE, '2026-09-27T00:00:00Z');
    await seedObservation(
      'undergradEvidenceQuote',
      GROUNDED,
      'department-undergrad-research',
      '2026-09-10T00:00:00Z',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedQuote(row._id)).toBe(GROUNDED);
  });

  it('leaves a locked quote alone', async () => {
    const row = await seedRow(SEARCH_NOTE, { manuallyLockedFields: ['undergradEvidenceQuote'] });
    await seedObservation('undergradEvidenceQuote', SEARCH_NOTE, LANE, '2026-09-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedQuote(row._id)).toBe(SEARCH_NOTE);
  });

  it('clears a lane quote cited to a department program page and does not fall back to the retired cache copy', async () => {
    const programPage = 'https://synthetic.yale.edu/undergraduate/employment-opportunities';
    const row = await seedRow(GROUNDED, { entityType: 'FACULTY_RESEARCH_AREA', websiteUrl: '' });
    await ResearchEntity.updateOne(
      { _id: row._id },
      { $set: { 'fieldProvenance.undergradEvidenceQuote.sourceUrl': programPage } },
    );
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'undergradEvidenceQuote',
      value: GROUNDED,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: LANE,
      sourceUrl: programPage,
      confidence: 0.5,
      observedAt: new Date('2026-09-20T00:00:00Z'),
      superseded: false,
    });
    await seedObservation(
      'undergradEvidenceQuote',
      PARAPHRASE,
      'research-entity-cache-backfill',
      '2026-09-01T00:00:00Z',
    );

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(await storedQuote(row._id)).toBe('');
  });
});
