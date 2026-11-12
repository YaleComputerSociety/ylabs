import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'estuary-microsite-page-fields-fixture';
const METHODS = ['sediment coring', 'isotope ratio mass spectrometry'];
const TOPICS = ['coastal sediment transport', 'salt marsh carbon storage'];
const UNDERGRAD_QUOTE =
  'Undergraduates join the group each semester to help process sediment cores in the laboratory.';

const REFUSED_PAGE = 'https://coastal-foundation.example.org/about';
const SURNAME_PAGE = 'https://varnadorelab.example.org/research';
const NAMING_PAGE = 'https://tidewater-collaborative.example.org/team';
const YALE_PAGE = 'https://medicine.yale.edu/lab/estuary/';

const SCREENED_FIELDS = ['methods', 'researchAreas', 'undergradEvidenceQuote'] as const;

describe('a non-Yale microsite page supplies no page-derived field unless it confirms the lead (#5920)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments'])
      await db.collection(name).deleteMany({});
    const entity = await ResearchEntity.create({
      slug: SLUG,
      name: 'Estuary Page Fields Fixture',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    const person = await Researcher.create({ displayName: 'Quillon Varnadore', archived: false });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      evidenceClaimIds: [],
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      state: 'CURRENT',
    });
  });

  const observe = (sourceName: string, field: string, value: unknown, sourceUrl: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
    });

  const seedMicrositePage = async (sourceUrl: string) => {
    await observe('lab-microsite-description-llm', 'methods', METHODS, sourceUrl);
    await observe('lab-microsite-description-llm', 'researchAreas', TOPICS, sourceUrl);
    await observe(
      'lab-microsite-undergrad-llm',
      'undergradEvidenceQuote',
      UNDERGRAD_QUOTE,
      sourceUrl,
    );
  };

  const plannedPageFields = async () => {
    const { plannedSet } = await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: true },
    );
    return Object.fromEntries(SCREENED_FIELDS.map((field) => [field, plannedSet?.[field]]));
  };

  const supplied = {
    methods: METHODS,
    researchAreas: TOPICS,
    undergradEvidenceQuote: UNDERGRAD_QUOTE,
  };

  it('a refused page supplies no methods, topics or undergraduate quote, and writes nothing', async () => {
    await seedMicrositePage(REFUSED_PAGE);
    const before = await Observation.find().lean();
    const planned = await plannedPageFields();
    expect(planned.methods).toBeUndefined();
    expect(planned.researchAreas ?? []).not.toEqual(expect.arrayContaining(TOPICS));
    expect(planned.undergradEvidenceQuote ?? '').not.toContain('sediment cores');

    await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: false });
    const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(row.methods ?? []).toEqual([]);
    expect(row.undergradEvidenceQuote ?? '').not.toContain('sediment cores');
    expect(row.manuallyLockedFields ?? []).toEqual([]);
    const after = await Observation.find().lean();
    expect(
      after.map((obs) => [String(obs._id), obs.superseded, JSON.stringify(obs.value)]),
    ).toEqual(before.map((obs) => [String(obs._id), obs.superseded, JSON.stringify(obs.value)]));
  });

  it('a refused page yields to Yale-hosted methods from another lane', async () => {
    await observe('dept-faculty-roster', 'methods', ['field surveys'], YALE_PAGE);
    await seedMicrositePage(REFUSED_PAGE);
    expect((await plannedPageFields()).methods).toEqual(['field surveys']);
  });

  it('a page whose address carries the lead surname still supplies every field', async () => {
    await seedMicrositePage(SURNAME_PAGE);
    expect(await plannedPageFields()).toEqual(supplied);
  });

  it('a page whose stored text names the lead still supplies every field', async () => {
    await seedMicrositePage(NAMING_PAGE);
    await observe(
      'research-page-text',
      'researchPageText',
      [{ url: NAMING_PAGE, text: 'Principal investigator: Quillon Varnadore.' }],
      NAMING_PAGE,
    );
    expect(await plannedPageFields()).toEqual(supplied);
  });

  it('a page whose own description names the lead still supplies its methods', async () => {
    await seedMicrositePage(NAMING_PAGE);
    await observe(
      'lab-microsite-description-llm',
      'fullDescription',
      'Quillon Varnadore leads field studies of how estuarine sediment moves during storm surges, combining tidal marsh cores with channel erosion models.',
      NAMING_PAGE,
    );
    expect((await plannedPageFields()).methods).toEqual(METHODS);
  });

  it('a Yale-hosted page still supplies every field', async () => {
    await seedMicrositePage(YALE_PAGE);
    expect(await plannedPageFields()).toEqual(supplied);
  });

  it('a lab row is unaffected', async () => {
    await ResearchEntity.updateOne({ slug: SLUG }, { $set: { entityType: 'LAB', kind: 'lab' } });
    await seedMicrositePage(REFUSED_PAGE);
    expect((await plannedPageFields()).methods).toEqual(METHODS);
  });

  it('a second materialize re-derives the same screened fields from the same evidence', async () => {
    await observe('dept-faculty-roster', 'methods', ['field surveys'], YALE_PAGE);
    await seedMicrositePage(REFUSED_PAGE);
    const storedPageFields = async () => {
      const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
      return {
        methods: row.methods,
        researchAreas: row.researchAreas,
        undergradEvidenceQuote: row.undergradEvidenceQuote,
        manuallyLockedFields: row.manuallyLockedFields,
      };
    };
    await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: false });
    const first = await storedPageFields();
    await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: false });
    const second = await storedPageFields();
    expect(first.methods).toEqual(['field surveys']);
    expect(first.manuallyLockedFields ?? []).toEqual([]);
    expect(second).toEqual(first);
  });
});
