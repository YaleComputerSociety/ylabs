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

/**
 * Pins `materializeEntity`'s empty-observation early return (#2467).
 *
 * This is not a coverage exercise. The early return is the only thing standing
 * between Beta/Production and a corpus-wide field drop: the promotion path copies
 * materialized collections without the evidence store, so both environments hold
 * **zero** observations against a full entity corpus (measured 2026-09-05:
 * Development 420,906 observations / 7,000 entities; Beta 0 / 6,440; Production
 * 0 / 6,440). Every `materializeEntity` call there reads an empty set. Without the
 * guard the materializer would derive fields from nothing and persist the result,
 * unsetting observation-backed fields on every entity it touched.
 *
 * The environment that makes the guard critical is not the one anyone develops
 * against, so these assertions exist to stop a refactor from removing it.
 */
const ENTITY_SLUG = 'empty-observation-fixture';

const seedFullyPopulatedEntity = async () =>
  ResearchEntity.create({
    slug: ENTITY_SLUG,
    name: 'Empty Observation Lab',
    displayName: 'Empty Observation Lab',
    entityType: 'LAB',
    kind: 'lab',
    school: 'Yale School of Medicine',
    departments: ['Immunobiology'],
    researchAreas: ['Immunology', 'Host Defense'],
    methods: ['Flow cytometry'],
    shortDescription: 'Studies mucosal immune responses to enteric infection.',
    fullDescription:
      'The laboratory studies how mucosal immune responses are established and maintained during enteric infection.',
    websiteUrl: 'https://example.edu/empty-observation-lab',
    archived: false,
  });

describe('materializeEntity empty-observation guard (#2467)', () => {
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

  // Documents the returned shape, and is deliberately NOT the guard-sensitive
  // assertion: with the early return deleted, this test still passes. The
  // unset-on-empty pass nulls fields while the result reports fieldsWritten 0,
  // conflicts 0, created false - identical to a real no-op. That is the reason the
  // tests below compare stored documents instead of trusting these counters, and
  // the reason a materialize run cannot be judged from its own return value.
  it('returns a no-op result when the entity has no observations', async () => {
    await seedFullyPopulatedEntity();
    expect(await Observation.countDocuments({})).toBe(0);

    const result = await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });

    expect(result.fieldsWritten).toBe(0);
    expect(result.created).toBe(false);
    expect(result.conflicts).toBe(0);
    expect(result.resolved).toEqual({});
  });

  // Named anchor for the field measured to drop when the guard is removed, so the
  // failure reads as "methods was nulled" rather than a whole-document diff.
  it('does not null the methods array, the measured casualty of guard removal', async () => {
    await seedFullyPopulatedEntity();

    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });

    const after = await ResearchEntity.findOne({ slug: ENTITY_SLUG }).lean<{
      methods?: string[];
    }>();
    expect(after?.methods).toEqual(['Flow cytometry']);
  });

  // The failure mode is a silent unset, so compare the whole stored document
  // rather than a chosen field list: a guard removal that dropped a field this
  // test forgot to name would otherwise pass.
  it('leaves every stored field on the entity untouched', async () => {
    await seedFullyPopulatedEntity();
    const before = await ResearchEntity.findOne({ slug: ENTITY_SLUG }).lean();
    expect(before).toBeTruthy();

    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });

    const after = await ResearchEntity.findOne({ slug: ENTITY_SLUG }).lean();
    expect(after).toEqual(before);
  });

  it('does not mint an entity for a key that has neither observations nor a row', async () => {
    const result = await materializeEntity('researchEntity', {
      entityKey: 'no-observations-no-entity',
    });

    expect(result.created).toBe(false);
    expect(result.fieldsWritten).toBe(0);
    expect(await ResearchEntity.countDocuments({ slug: 'no-observations-no-entity' })).toBe(0);
  });

  // The Beta/Production shape: a full entity corpus with an empty evidence store.
  // A guard removal shows up here as many entities losing fields at once, which is
  // the corpus-wide drop the guard prevents.
  it('leaves a whole corpus untouched when the evidence store is empty', async () => {
    const slugs = ['corpus-a', 'corpus-b', 'corpus-c'];
    for (const slug of slugs) {
      await ResearchEntity.create({
        slug,
        name: `${slug} Lab`,
        entityType: 'LAB',
        kind: 'lab',
        researchAreas: ['Immunology'],
        methods: ['Flow cytometry'],
        shortDescription: 'Studies mucosal immune responses to enteric infection.',
        archived: false,
      });
    }
    const before = await ResearchEntity.find({ slug: { $in: slugs } })
      .sort({ slug: 1 })
      .lean();

    for (const slug of slugs) {
      await materializeEntity('researchEntity', { entityKey: slug });
    }

    const after = await ResearchEntity.find({ slug: { $in: slugs } })
      .sort({ slug: 1 })
      .lean();
    expect(after).toEqual(before);
    expect(after.every((entity) => (entity.researchAreas || []).length > 0)).toBe(true);
    expect(after.every((entity) => Boolean(entity.shortDescription))).toBe(true);
  });
});
