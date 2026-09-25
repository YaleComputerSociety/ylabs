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
import { DERIVED_RESEARCH_AREA_SOURCE_NAME, materializeEntity } from '../entityMaterializer';
import { dropDomainIncoherentUnsourcedResearchAreas } from '../../utils/researchAreaDomainCoherence';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../researchAreaCanonicalization';

type PersistedEntity = { departments?: string[]; researchAreas?: string[] };

describe('materializeEntity derives LAB/FACULTY_RESEARCH_AREA research areas from description (#1717)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
    resetResearchAreaCanonicalizerCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    setResearchAreaCanonicalizerForTesting(
      createResearchAreaCanonicalizer(
        buildResearchAreaResolverIndex([{ name: 'Neuroscience' }, { name: 'Immunology' }]),
      ),
    );
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'area-derivation-fixture',
      name: 'Area Derivation Fixture',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedField = async (field: string, value: unknown, sourceName = 'nih-reporter') => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'area-derivation-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: 'https://reporter.nih.gov/project-details/00000000',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('derives areas from an empty-area LAB whose description names canonical topics', async () => {
    await seedEntity();
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(new Set(persisted?.researchAreas ?? [])).toEqual(
      new Set(['Neuroscience', 'Immunology']),
    );
  });

  it('derives when rejection empties an observed area list, which the first attempt cannot see', async () => {
    // The observed list is non-empty when the fallback first looks, so it returns
    // early; rejection then empties it, and without a second attempt the row keeps no
    // chips at all. Measured on Development on a served row carrying six observed
    // areas whose winner named only its own department and a division-level label.
    await seedEntity({ departments: ['Immunology'] });
    await seedField('researchAreas', ['Immunology']);
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    // Immunology stays rejected as this row's own department; Neuroscience is
    // recovered from the description the row already carries.
    expect(persisted?.researchAreas).toEqual(['Neuroscience']);
  });

  it('leaves a row area-less when rejection empties the list and the prose names nothing else', async () => {
    await seedEntity({ departments: ['Immunology'] });
    await seedField('researchAreas', ['Immunology']);
    await seedField('fullDescription', 'The lab welcomes motivated students to apply each term.');

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas).toEqual([]);
  });

  it('never recovers a chip that rejection just removed', async () => {
    // The fallback must not launder a rejected label back in by deriving it from
    // prose that names the same thing.
    await seedEntity({ departments: ['Immunology'] });
    await seedField('researchAreas', ['Immunology']);
    await seedField('fullDescription', 'The lab studies immunology and nothing else.');

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas).toEqual([]);
  });

  it('records provenance for the chips it derives, so the serve-time guard keeps them (#3401)', async () => {
    await seedEntity({ departments: ['Cardiology'] });
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity & { fieldProvenance?: Record<string, { sourceName?: string }> }>();

    expect(new Set(persisted?.researchAreas ?? [])).toEqual(
      new Set(['Neuroscience', 'Immunology']),
    );
    expect(persisted?.fieldProvenance?.researchAreas?.sourceName).toBe(
      DERIVED_RESEARCH_AREA_SOURCE_NAME,
    );

    // The point of the provenance: the guard judges only unsourced chips, and these
    // chips share no token with a description that says neither word in that form.
    expect(
      dropDomainIncoherentUnsourcedResearchAreas(
        persisted?.researchAreas ?? [],
        persisted?.fieldProvenance,
        {
          name: 'Area Derivation Fixture',
          departments: ['Cardiology'],
          fullDescription: 'The lab focuses on the intersection of neuroscience and immunology.',
        },
      ),
    ).toEqual(persisted?.researchAreas);
  }, 30000);

  it('re-plans the same provenance entry it stored, so a re-derived row never churns', async () => {
    // The fallback path is where derivation genuinely re-runs on every pass: the
    // observed list is non-empty when the first attempt looks, rejection empties it,
    // and the fallback derives again. The entry it re-plans must be byte-identical to
    // the one already stored, key order included, because the diff-skip compares with
    // JSON.stringify - otherwise every run rewrites the row and re-syncs Meilisearch.
    await seedEntity({ departments: ['Immunology'] });
    await seedField('researchAreas', ['Immunology']);
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });
    const stored = await ResearchEntity.findOne({ slug: 'area-derivation-fixture' }).lean<
      PersistedEntity & { updatedAt?: Date; fieldProvenance?: Record<string, unknown> }
    >();
    expect(stored?.researchAreas).toEqual(['Neuroscience']);
    expect(
      (stored?.fieldProvenance?.researchAreas as { sourceName?: string } | undefined)?.sourceName,
    ).toBe(DERIVED_RESEARCH_AREA_SOURCE_NAME);

    const replanned = await materializeEntity(
      'researchEntity',
      { entityKey: 'area-derivation-fixture' },
      { dryRun: true },
    );
    expect(JSON.stringify(replanned.plannedSet?.['fieldProvenance.researchAreas'])).toBe(
      JSON.stringify(stored?.fieldProvenance?.researchAreas),
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });
    const after = await ResearchEntity.findOne({ slug: 'area-derivation-fixture' }).lean<{
      updatedAt?: Date;
    }>();
    expect(after?.updatedAt?.getTime()).toBe(stored?.updatedAt?.getTime());
  }, 30000);

  it('records no provenance when rejection leaves the derivation with no chip at all', async () => {
    // Provenance is recorded inside the derivation, before canonicalization can reject
    // what it derived. A row that ends with no chips must not keep a record claiming
    // its description supplied some, or the detail page attributes Topics nobody serves.
    await seedEntity({ departments: ['Immunology'] });
    await seedField('researchAreas', ['Immunology']);
    await seedField('fullDescription', 'The lab studies immunology and nothing else.');

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({ slug: 'area-derivation-fixture' }).lean<
      PersistedEntity & { fieldProvenance?: Record<string, unknown> }
    >();

    expect(persisted?.researchAreas).toEqual([]);
    expect(persisted?.fieldProvenance?.researchAreas).toBeUndefined();
  }, 30000);

  it('attributes an already-stored derived array, so the existing cohort is reachable (#3401)', async () => {
    // The pre-fix shape: chips derivation produced, stored with no provenance entry,
    // and no observation to re-derive them from. Forward-only code never reached this.
    await seedEntity({ researchAreas: ['Neuroscience', 'Immunology'] });
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity & { fieldProvenance?: Record<string, { sourceName?: string }> }>();

    expect(new Set(persisted?.researchAreas ?? [])).toEqual(
      new Set(['Neuroscience', 'Immunology']),
    );
    expect(persisted?.fieldProvenance?.researchAreas?.sourceName).toBe(
      DERIVED_RESEARCH_AREA_SOURCE_NAME,
    );
  }, 30000);

  it('refuses to attribute a stored array re-derivation does not reproduce', async () => {
    // These chips are not what this description yields, so some other lane wrote them
    // and merely failed to record it. Stamping this lane's name on them would be a lie.
    await seedEntity({ researchAreas: ['Immunology'] });
    await seedField('fullDescription', 'The lab focuses on neuroscience alone.');

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity & { fieldProvenance?: Record<string, unknown> }>();

    expect(persisted?.researchAreas).toEqual(['Immunology']);
    expect(persisted?.fieldProvenance?.researchAreas).toBeUndefined();
  }, 30000);

  it('leaves an observation-backed array for its own lane to attribute', async () => {
    await seedEntity({ researchAreas: ['Neuroscience', 'Immunology'] });
    await seedField('researchAreas', ['Neuroscience', 'Immunology']);
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<{ fieldProvenance?: Record<string, { sourceName?: string }> }>();

    expect(persisted?.fieldProvenance?.researchAreas?.sourceName).not.toBe(
      DERIVED_RESEARCH_AREA_SOURCE_NAME,
    );
  }, 30000);

  it('never overwrites an existing non-empty researchAreas value', async () => {
    await seedEntity({ researchAreas: ['Immunology'] });
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas).toEqual(['Immunology']);
  });

  it('leaves an empty-area LAB whose description names no canonical topic area-less', async () => {
    await seedEntity();
    await seedField('fullDescription', 'The lab welcomes motivated students to apply each term.');

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas ?? []).toEqual([]);
  });

  it('does not derive areas for a non-LAB/FACULTY_RESEARCH_AREA entity type', async () => {
    await seedEntity({ entityType: 'CENTER', kind: 'center' });
    await seedField(
      'fullDescription',
      'The center focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas ?? []).toEqual([]);
  });
});
