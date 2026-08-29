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
import { materializeEntity } from '../../scrapers/entityMaterializer';
import {
  describeDescriptionPairRisk,
  descriptionPairObservationFilter,
  planDescriptionPairRollback,
} from '../descriptionPairRollbackCore';

const SLUG = 'pair-rollback-fixture';
const SYNTHESIS_SOURCE = 'fra-profile-research-synthesis';
const MICROSITE_SOURCE = 'lab-microsite-undergrad-llm';

const SYNTHESIZED_FULL =
  'Work in the group spans mouse genetics, single-cell sequencing, and protein biochemistry to define how shelterin loss triggers replicative senescence, and it tests small-molecule interventions that restore proliferative capacity in aged tissue.';

const SHORT_DERIVED_FROM_SYNTHESIZED_FULL =
  'Studies how shelterin loss triggers replicative senescence and tests interventions that restore proliferative capacity.';

const MICROSITE_FULL =
  'The Hansen Laboratory studies how shelterin loss triggers replicative senescence and tests interventions that restore proliferative capacity.';

type PersistedEntity = {
  fullDescription?: string;
  shortDescription?: string;
  studentVisibilityTier?: string;
};

const observe = async (input: {
  field: string;
  value: string;
  sourceName: string;
  sourceUrl: string;
  confidence: number;
  entityKey?: string;
  entityId?: string;
}) => {
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: input.entityKey,
    entityId: input.entityId,
    field: input.field,
    value: input.value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    confidence: input.confidence,
    observedAt: new Date('2026-02-01T00:00:00Z'),
    superseded: false,
  });
};

const loadPersisted = async () =>
  (await ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>()) ?? {};

const activeDescriptionRows = async () =>
  (
    await Observation.find({
      entityType: 'researchEntity',
      field: { $in: ['fullDescription', 'shortDescription'] },
      superseded: { $ne: true },
    })
      .select('field sourceName')
      .lean<{ field: string; sourceName: string }[]>()
  )
    .map((row) => `${row.sourceName}/${row.field}`)
    .sort();

const rematerializeUntilStable = async () => {
  await materializeEntity('researchEntity', { entityKey: SLUG });
  await materializeEntity('researchEntity', { entityKey: SLUG });
};

describe('description-pair rollback driven through the live materializer', () => {
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

  const seedServedEntity = async () =>
    ResearchEntity.create({
      slug: SLUG,
      name: 'Hansen Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });

  /**
   * The incident shape: one source synthesized the full description and, from a
   * second URL, a card condensed from that same prose; a lower-confidence
   * microsite full restates the card.
   */
  const seedIncidentShape = async () => {
    await seedServedEntity();
    await observe({
      field: 'name',
      value: 'Hansen Lab',
      sourceName: SYNTHESIS_SOURCE,
      sourceUrl: 'https://example.edu/fra/profile/hansen',
      confidence: 0.9,
      entityKey: SLUG,
    });
    await observe({
      field: 'fullDescription',
      value: SYNTHESIZED_FULL,
      sourceName: SYNTHESIS_SOURCE,
      sourceUrl: 'https://example.edu/fra/profile/hansen',
      confidence: 0.9,
      entityKey: SLUG,
    });
    await observe({
      field: 'shortDescription',
      value: SHORT_DERIVED_FROM_SYNTHESIZED_FULL,
      sourceName: SYNTHESIS_SOURCE,
      sourceUrl: 'https://example.edu/fra/card/hansen',
      confidence: 0.9,
      entityKey: SLUG,
    });
    await observe({
      field: 'fullDescription',
      value: MICROSITE_FULL,
      sourceName: MICROSITE_SOURCE,
      sourceUrl: 'https://example.edu/hansen-lab/',
      confidence: 0.55,
      entityKey: SLUG,
    });

    await rematerializeUntilStable();
    const seeded = await loadPersisted();
    expect(seeded.fullDescription).toBe(SYNTHESIZED_FULL);
    expect(seeded.shortDescription).toBe(SHORT_DERIVED_FROM_SYNTHESIZED_FULL);
    expect(describeDescriptionPairRisk(seeded)).toBeNull();
    return seeded;
  };

  it('empties a served student_ready record when only fullDescription is rolled back', async () => {
    await seedIncidentShape();
    // The surviving alternative is genuinely useful on its own, so restatement
    // against the stale card is the only reason it can be refused.
    expect(
      describeDescriptionPairRisk({ fullDescription: MICROSITE_FULL, shortDescription: '' }),
    ).toBeNull();
    expect(
      describeDescriptionPairRisk({
        fullDescription: MICROSITE_FULL,
        shortDescription: SHORT_DERIVED_FROM_SYNTHESIZED_FULL,
      }),
    ).toBe('full-restates-short');

    const superseded = await Observation.updateMany(
      {
        entityType: 'researchEntity',
        entityKey: SLUG,
        sourceName: SYNTHESIS_SOURCE,
        field: 'fullDescription',
        superseded: { $ne: true },
      },
      { $set: { superseded: true } },
    );
    expect(superseded.modifiedCount).toBe(1);

    await rematerializeUntilStable();

    const persisted = await loadPersisted();
    expect(persisted.fullDescription).toBe('');
    expect(persisted.shortDescription).toBe(SHORT_DERIVED_FROM_SYNTHESIZED_FULL);
    expect(persisted.studentVisibilityTier).toBe('student_ready');
    expect(describeDescriptionPairRisk(persisted)).toBe('empty-full-description');
  });

  it('restores served prose when the coupled pair is rolled back together', async () => {
    await seedIncidentShape();

    const plan = planDescriptionPairRollback({
      entity: { entityType: 'researchEntity', entityKey: SLUG },
      sourceName: SYNTHESIS_SOURCE,
      observations: await Observation.find({ entityType: 'researchEntity' }).lean(),
    });
    expect(plan.fieldsToSupersede).toEqual(['fullDescription', 'shortDescription']);
    expect(plan.shortWrittenElsewhere).toBe(false);

    const superseded = await Observation.updateMany(
      descriptionPairObservationFilter({
        entityType: 'researchEntity',
        entityKey: SLUG,
        sourceName: SYNTHESIS_SOURCE,
      }),
      { $set: { superseded: true } },
    );
    expect(superseded.modifiedCount).toBe(2);
    expect(await activeDescriptionRows()).toEqual([`${MICROSITE_SOURCE}/fullDescription`]);

    // Superseding the rows is not the whole operation. `shortDescription` is not
    // clearable-on-empty, so the projected card outlives its observation and the
    // guard still refuses the alternative full. Checking the served record rather
    // than the supersede count is what surfaces this.
    await rematerializeUntilStable();
    const afterSupersedeOnly = await loadPersisted();
    expect(afterSupersedeOnly.fullDescription).toBe('');
    expect(describeDescriptionPairRisk(afterSupersedeOnly)).toBe('empty-full-description');

    await ResearchEntity.updateOne(
      { slug: SLUG },
      { $unset: Object.fromEntries(plan.entityFieldsToUnset.map((path) => [path, ''])) },
    );
    await rematerializeUntilStable();

    const persisted = await loadPersisted();
    expect(persisted.fullDescription).toBe(MICROSITE_FULL);
    expect(persisted.shortDescription).toBeTruthy();

    await materializeEntity('researchEntity', { entityKey: SLUG });
    const stable = await loadPersisted();
    expect(stable.fullDescription).toBe(MICROSITE_FULL);
    expect(stable.shortDescription).toBe(persisted.shortDescription);
    // The re-derived card restates the full it was condensed from, and the guard
    // excludes a self-derived short, so the repaired record must read as
    // serviceable. Comparing the raw stored short here reported `full-restates-short`
    // on a record the materializer serves stably across passes.
    expect(describeDescriptionPairRisk(stable)).toBeNull();
  });

  it('blanks the record again when the prior pair is restored, and reports it in advance', async () => {
    await seedServedEntity();
    await observe({
      field: 'name',
      value: 'Hansen Lab',
      sourceName: MICROSITE_SOURCE,
      sourceUrl: 'https://example.edu/hansen-lab/',
      confidence: 0.55,
      entityKey: SLUG,
    });
    // A restored pair whose two members differ only by a lead clause: both are
    // observation-backed, so the restore looks legitimate row-by-row.
    await observe({
      field: 'fullDescription',
      value: MICROSITE_FULL,
      sourceName: MICROSITE_SOURCE,
      sourceUrl: 'https://example.edu/hansen-lab/',
      confidence: 0.55,
      entityKey: SLUG,
    });
    await observe({
      field: 'shortDescription',
      value: SHORT_DERIVED_FROM_SYNTHESIZED_FULL,
      sourceName: MICROSITE_SOURCE,
      sourceUrl: 'https://example.edu/hansen-lab/undergrads',
      confidence: 0.55,
      entityKey: SLUG,
    });

    expect(
      describeDescriptionPairRisk({
        fullDescription: MICROSITE_FULL,
        shortDescription: SHORT_DERIVED_FROM_SYNTHESIZED_FULL,
      }),
    ).toBe('full-restates-short');

    await rematerializeUntilStable();

    const persisted = await loadPersisted();
    expect(persisted.fullDescription).toBe('');
    expect(persisted.shortDescription).toBe(SHORT_DERIVED_FROM_SYNTHESIZED_FULL);
    expect(describeDescriptionPairRisk(persisted)).toBe('empty-full-description');
  });

  it('supersedes description rows filed under entityId as well as entityKey', async () => {
    const entity = await seedServedEntity();
    const entityId = String(entity._id);
    await observe({
      field: 'fullDescription',
      value: SYNTHESIZED_FULL,
      sourceName: SYNTHESIS_SOURCE,
      sourceUrl: 'https://example.edu/fra/profile/hansen',
      confidence: 0.9,
      entityId,
    });
    await observe({
      field: 'shortDescription',
      value: SHORT_DERIVED_FROM_SYNTHESIZED_FULL,
      sourceName: SYNTHESIS_SOURCE,
      sourceUrl: 'https://example.edu/fra/card/hansen',
      confidence: 0.9,
      entityKey: SLUG,
    });

    const keyOnlyMatches = await Observation.countDocuments(
      descriptionPairObservationFilter({
        entityType: 'researchEntity',
        entityKey: SLUG,
        sourceName: SYNTHESIS_SOURCE,
      }),
    );
    expect(keyOnlyMatches).toBe(1);

    const superseded = await Observation.updateMany(
      descriptionPairObservationFilter({
        entityType: 'researchEntity',
        entityKey: SLUG,
        entityId,
        sourceName: SYNTHESIS_SOURCE,
      }),
      { $set: { superseded: true } },
    );
    expect(superseded.modifiedCount).toBe(2);
    expect(await activeDescriptionRows()).toEqual([]);
  });

  it('keeps serving prose when one source emits the identical string as both fields', async () => {
    // The `studentReadyDescription` emit block pushes one string as both fields
    // from the same URL, so both land with one provenance, the materializer reads
    // the card as self-derived from the full, and the guard is never applied: the
    // record keeps its prose across repeated runs. Duplication alone does not blank
    // a row; separate attribution of the two members does, which is what the
    // `blanks the record again ...` case above covers.
    const manufactured =
      'The laboratory studies hand and wrist trauma, arthritis, nerve injury, and tendon pathology in adults.';
    await seedServedEntity();
    for (const field of ['name', 'fullDescription', 'shortDescription'] as const) {
      await observe({
        field,
        value: field === 'name' ? 'Hansen Lab' : manufactured,
        sourceName: MICROSITE_SOURCE,
        sourceUrl: 'https://example.edu/hansen-lab/',
        confidence: 0.55,
        entityKey: SLUG,
      });
    }

    await rematerializeUntilStable();
    const first = await loadPersisted();
    await materializeEntity('researchEntity', { entityKey: SLUG });
    const second = await loadPersisted();

    expect(first.fullDescription).toBe(manufactured);
    expect(second.fullDescription).toBe(first.fullDescription);
    expect(second.shortDescription).toBe(first.shortDescription);
    expect(second.shortDescription).not.toBe('');
    expect(describeDescriptionPairRisk(second)).toBeNull();
  });
});
