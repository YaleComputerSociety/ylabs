import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
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
import { appendObservations, retireObservations } from '../observationStore';
import type { ObservationInput } from '../types';

const SLUG = 'synthetic-membrane-folding-lab';
const MERGED_SLUG = 'synthetic-membrane-folding-group';
const NAME = 'Synthetic Membrane Folding Lab';
const GRAFT_LANE = 'official-profile-pi-backfill';
const RIVAL_LANE = 'lab-microsite-description-llm';
const UNDERGRAD_LANE = 'lab-microsite-undergrad-llm';
const NAME_LANE = 'ysm-atoz-index';
const WEBSITE = 'https://synthetic-membrane-folding.example.edu/';
const PAGE = 'https://synthetic-membrane-folding.example.edu/people';

let rowId = '';

async function lanes(sourceName: string, observations: Omit<ObservationInput, 'entityType'>[]) {
  await appendObservations(
    observations.map((observation) => ({
      entityType: 'researchEntity' as const,
      entityId: rowId,
      entityKey: SLUG,
      sourceUrl: PAGE,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      ...observation,
    })),
    {
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceId: new mongoose.Types.ObjectId().toString(),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const resolve = () => materializeEntity('researchEntity', { entityId: rowId }, {});

const stored = async () =>
  ResearchEntity.collection.findOne({ _id: new mongoose.Types.ObjectId(rowId) }) as Promise<
    Record<string, any>
  >;

const retireLane = (sourceName: string, field: string) =>
  retireObservations({ sourceName, field }, 'synthetic retirement for the test');

describe('a stored field whose every backing observation is retired clears on resolve (#4872)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    const row = await ResearchEntity.create({ slug: SLUG, name: NAME, entityType: 'LAB' });
    rowId = String(row._id);
    await lanes(NAME_LANE, [{ field: 'name', value: NAME }]);
    await lanes(GRAFT_LANE, [{ field: 'website', value: WEBSITE }]);
    await lanes(UNDERGRAD_LANE, [{ field: 'currentUndergradCount', value: 3 }]);
    await resolve();
    const before = await stored();
    expect(before.website).toBe(WEBSITE);
    expect(before.currentUndergradCount).toBe(3);
  });

  it('clears the field, keeps it cleared on the next resolve, and sets no lock', async () => {
    await retireLane(GRAFT_LANE, 'website');
    await retireLane(UNDERGRAD_LANE, 'currentUndergradCount');

    await resolve();
    const after = await stored();
    expect(after.website).toBeUndefined();
    expect(after.fieldProvenance?.website).toBeUndefined();
    expect(after.currentUndergradCount).toBeUndefined();
    expect(after.name).toBe(NAME);
    expect(after.manuallyLockedFields ?? []).toEqual([]);

    await resolve();
    expect((await stored()).website).toBeUndefined();
  });

  it('keeps the field while another lane still states it', async () => {
    await lanes(RIVAL_LANE, [{ field: 'website', value: WEBSITE }]);
    await retireLane(GRAFT_LANE, 'website');

    await resolve();
    expect((await stored()).website).toBe(WEBSITE);
  });

  it('keeps a locked field whose evidence was retired', async () => {
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      { $set: { manuallyLockedFields: ['website'] } },
    );
    await retireLane(GRAFT_LANE, 'website');

    await resolve();
    expect((await stored()).website).toBe(WEBSITE);
  });

  it('keeps a field an operator refusal governs', async () => {
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      {
        $set: {
          fieldValueRefusals: {
            website: [
              {
                valueKey: 'synthetic-other.example.edu',
                rule: 'operator_judgement',
                refusedBy: 'synthetic-operator',
              },
            ],
          },
        },
      },
    );
    await retireLane(GRAFT_LANE, 'website');

    await resolve();
    expect((await stored()).website).toBe(WEBSITE);
  });

  it('keeps a value whose provenance never cited an observation', async () => {
    await ResearchEntity.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rowId) },
      { $set: { 'fieldProvenance.website': { sourceName: 'legacy-import' } } },
    );
    await retireLane(GRAFT_LANE, 'website');

    await resolve();
    expect((await stored()).website).toBe(WEBSITE);
  });

  it('keeps a value whose cited observation was pruned rather than retired', async () => {
    await Observation.deleteMany({ sourceName: GRAFT_LANE, field: 'website' });

    await resolve();
    expect((await stored()).website).toBe(WEBSITE);
  });

  it('keeps a value a live observation on a merged-in row still states', async () => {
    const mergedIn = await ResearchEntity.create({
      slug: MERGED_SLUG,
      name: NAME,
      entityType: 'LAB',
      archived: true,
      canonicalGroupId: rowId,
    });
    await lanes(UNDERGRAD_LANE, [
      {
        entityId: String(mergedIn._id),
        entityKey: MERGED_SLUG,
        field: 'currentUndergradCount',
        value: 3,
      },
    ]);
    await Observation.updateMany(
      { sourceName: UNDERGRAD_LANE, entityKey: SLUG },
      { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: 'synthetic' } } },
    );

    await resolve();
    expect((await stored()).currentUndergradCount).toBe(3);
  });

  it('clears a value the merged-in row states differently', async () => {
    const mergedIn = await ResearchEntity.create({
      slug: MERGED_SLUG,
      name: NAME,
      entityType: 'LAB',
      archived: true,
      canonicalGroupId: rowId,
    });
    await lanes(UNDERGRAD_LANE, [
      {
        entityId: String(mergedIn._id),
        entityKey: MERGED_SLUG,
        field: 'currentUndergradCount',
        value: 1,
      },
    ]);
    await Observation.updateMany(
      { sourceName: UNDERGRAD_LANE, entityKey: SLUG },
      { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: 'synthetic' } } },
    );

    await resolve();
    expect((await stored()).currentUndergradCount).toBeUndefined();
  });

  it('clears nothing in a pass scoped to other fields', async () => {
    await retireLane(GRAFT_LANE, 'website');

    await materializeEntity('researchEntity', { entityId: rowId }, { writeOnlyFields: ['name'] });
    expect((await stored()).website).toBe(WEBSITE);
  });
});
