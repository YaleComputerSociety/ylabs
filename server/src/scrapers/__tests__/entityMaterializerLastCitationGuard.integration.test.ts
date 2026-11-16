import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(true),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0 }) };
});

import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'synthetic-last-citation-row';
const ONLY_CITATION = 'https://example.edu/synthetic-gone-page/';
const RETIRED_REPAIR = 'synthetic-retired-repair';

describe('the materializer keeps a row last citation stamp (#6320)', () => {
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
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const collection = () => mongoose.connection.db!.collection('research_entities');

  const seed = async (studentVisibilityTier: string) => {
    await collection().insertOne({
      slug: SLUG,
      name: 'Synthetic Member Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [],
      manuallyLockedFields: [],
      studentVisibilityTier,
      fieldProvenance: {
        entityType: {
          sourceName: RETIRED_REPAIR,
          sourceUrl: ONLY_CITATION,
          observedAt: new Date('2026-08-24T00:00:00Z'),
          confidence: 0.9,
        },
      },
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'name',
      value: 'Synthetic Member Faculty Research',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      confidence: 0.8,
      observedAt: new Date('2026-09-20T00:00:00Z'),
      superseded: false,
    });
  };

  const stored = async () => (await collection().findOne({ slug: SLUG })) as Record<string, any>;

  it('withholds the retirement of the only stamp on a served row, in the dry run and the apply', async () => {
    await seed('student_ready');

    const planned = await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: true },
    );
    expect(Object.keys(planned.plannedUnset ?? {})).not.toContain('fieldProvenance.entityType');
    expect(planned.lastCitationRemovalsWithheld).toEqual(['fieldProvenance.entityType']);

    const applied = await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(applied.lastCitationRemovalsWithheld).toEqual(['fieldProvenance.entityType']);
    expect((await stored()).fieldProvenance?.entityType?.sourceUrl).toBe(ONLY_CITATION);
  });

  it('withholds the same retirement on a held row, which the next gate run would otherwise promote', async () => {
    await seed('operator_review');

    const applied = await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(applied.lastCitationRemovalsWithheld).toEqual(['fieldProvenance.entityType']);
    expect((await stored()).fieldProvenance?.entityType?.sourceUrl).toBe(ONLY_CITATION);
  });
});
