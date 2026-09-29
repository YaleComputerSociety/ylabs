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
import { TaxonomyTerm } from '../../models/taxonomyTerm';
import { ResearchEntity } from '../../models/researchEntity';
import { DERIVED_RESEARCH_AREA_SOURCE_NAME, materializeEntity } from '../entityMaterializer';
import { loadResearchAreaEvidenceBackedRowIds } from '../researchAreaEvidence';
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

  const seedField = async (
    field: string,
    value: unknown,
    sourceName = 'nih-reporter',
    confidence = 0.95,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'area-derivation-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: 'https://reporter.nih.gov/project-details/00000000',
      confidence,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('fails the row instead of writing no chips when the vocabulary cannot be loaded', async () => {
    await seedEntity();
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );
    resetResearchAreaCanonicalizerCache();
    const findSpy = vi.spyOn(TaxonomyTerm, 'find').mockImplementation(() => {
      throw new Error('MongoServerSelectionError: connection refused');
    });

    try {
      await expect(
        materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' }),
      ).rejects.toThrow(/connection refused/);
    } finally {
      findSpy.mockRestore();
    }
  });

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

  it('re-plans no change to the chips and provenance it derived, so the row never churns', async () => {
    // The observed list is non-empty when the first attempt looks, rejection empties
    // it, and the fallback derives. On the next pass the stored derived chips outrank
    // the still-rejected observation, so nothing is re-planned over them and the
    // diff-skip leaves the row alone instead of rewriting it and re-syncing Meilisearch.
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
    expect(replanned.plannedSet).not.toHaveProperty('researchAreas');
    expect(replanned.plannedSet).not.toHaveProperty(['fieldProvenance.researchAreas']);

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

  describe('an observation whose every area the row rejects is no evidence (#3836)', () => {
    const AREA_LESS_PROSE = 'The lab welcomes motivated students to apply each term.';
    const readRow = () =>
      ResearchEntity.findOne({ slug: 'area-derivation-fixture' }).lean<
        PersistedEntity & {
          _id: unknown;
          updatedAt?: Date;
          fieldProvenance?: Record<string, { sourceName?: string }>;
        }
      >();

    it('keeps the stored chips when the only new observation names the row own department', async () => {
      await seedEntity({
        departments: ['Psychology'],
        researchAreas: ['Memory Research', 'Neuroscience'],
      });
      await seedField('researchAreas', ['Psychology'], 'research-area-source-extractor');
      await seedField('fullDescription', AREA_LESS_PROSE);

      await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

      const persisted = await readRow();
      expect(persisted?.researchAreas).toEqual(['Memory Research', 'Neuroscience']);
      expect(persisted?.fieldProvenance?.researchAreas).toBeUndefined();
      expect([...(await loadResearchAreaEvidenceBackedRowIds([persisted!]))]).toEqual([]);
    });

    it('keeps the stored chips over description derivation the rejected observation would open', async () => {
      await seedEntity({
        departments: ['Psychology'],
        researchAreas: ['Memory Research'],
        confidenceByField: { researchAreas: 0.7 },
      });
      await seedField('researchAreas', ['Psychology'], 'research-area-source-extractor');
      await seedField('fullDescription', 'The lab studies neuroscience.');

      await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

      const persisted = await readRow();
      expect(persisted?.researchAreas).toEqual(['Memory Research']);
      expect(persisted?.fieldProvenance?.researchAreas).toBeUndefined();
      expect(
        (persisted as { confidenceByField?: Record<string, number> } | null)?.confidenceByField
          ?.researchAreas,
      ).toBe(0.7);
    });

    it('keeps the stored chips when the only new observation names a division-level label', async () => {
      await seedEntity({ departments: ['Psychology'], researchAreas: ['Memory Research'] });
      await seedField('researchAreas', ['Pediatrics'], 'research-area-source-extractor');
      await seedField('fullDescription', AREA_LESS_PROSE);

      await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

      expect((await readRow())?.researchAreas).toEqual(['Memory Research']);
    });

    it('keeps the real topic of a mixed observation and drops the own department', async () => {
      await seedEntity({ departments: ['Psychology'], researchAreas: ['Memory Research'] });
      await seedField(
        'researchAreas',
        ['Psychology', 'Neuroscience'],
        'research-area-source-extractor',
      );
      await seedField('fullDescription', AREA_LESS_PROSE);

      await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

      const persisted = await readRow();
      expect(persisted?.researchAreas).toEqual(['Neuroscience']);
      expect(persisted?.fieldProvenance?.researchAreas?.sourceName).toBe(
        'research-area-source-extractor',
      );
    });

    it('falls through to the next-ranked observation that states an admissible area', async () => {
      await seedEntity({ departments: ['Psychology'] });
      await seedField('researchAreas', ['Psychology'], 'department-directory', 0.95);
      await seedField('researchAreas', ['Neuroscience'], 'research-area-source-extractor', 0.6);
      await seedField('fullDescription', AREA_LESS_PROSE);

      await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });
      const stored = await readRow();
      expect(stored?.researchAreas).toEqual(['Neuroscience']);
      expect(stored?.fieldProvenance?.researchAreas?.sourceName).toBe(
        'research-area-source-extractor',
      );
      expect(
        (stored as { confidenceByField?: Record<string, number> } | null)?.confidenceByField
          ?.researchAreas,
      ).toBe(1);

      const replanned = await materializeEntity(
        'researchEntity',
        { entityKey: 'area-derivation-fixture' },
        { dryRun: true },
      );
      expect(replanned.plannedSet?.researchAreas).toEqual(stored?.researchAreas);
      expect(JSON.stringify(replanned.plannedSet?.['fieldProvenance.researchAreas'])).toBe(
        JSON.stringify(stored?.fieldProvenance?.researchAreas),
      );
      expect(replanned.plannedSet?.confidenceByField).toEqual(
        (stored as { confidenceByField?: unknown } | null)?.confidenceByField,
      );
    }, 30000);

    it('still removes a stored department echo rather than protecting it', async () => {
      await seedEntity({
        departments: ['Psychology'],
        researchAreas: ['Psychology', 'Memory Research'],
      });
      await seedField('researchAreas', ['Psychology'], 'research-area-source-extractor');
      await seedField('fullDescription', AREA_LESS_PROSE);

      await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

      expect((await readRow())?.researchAreas).toEqual(['Memory Research']);
    });
  });

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
