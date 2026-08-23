import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { ResearchEntity } from '../../models/researchEntity';
import { syncEntity } from '../../services/meiliSyncService';
import { runResearchEntityNameRunonBackfill } from '../backfillResearchEntityNameRunons';

const RUNON_NAME =
  'Fineberg Lab The Fineberg Lab investigates the neural circuits underlying mood disorders.';
const RUNON_DISPLAY_NAME =
  'Fineberg Lab The Fineberg Lab investigates the neural circuits underlying mood disorders.';

describe('runResearchEntityNameRunonBackfill (#950)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
    vi.mocked(syncEntity).mockClear();
  });

  const createEntity = async (params: { slug: string; name: string; displayName?: string }) =>
    ResearchEntity.create({
      slug: params.slug,
      name: params.name,
      displayName: params.displayName,
      entityType: 'LAB',
      fullDescription: 'A complete, source-backed description of the research work.',
      status: 'ACTIVE',
      archived: false,
    });

  it('reports a run-on fix on dry-run without mutating the database or syncing Meili', async () => {
    await createEntity({
      slug: 'nih-pi-sarah-fineberg',
      name: RUNON_NAME,
      displayName: RUNON_DISPLAY_NAME,
    });

    const result = await runResearchEntityNameRunonBackfill({ dryRun: true });

    expect(result.mode).toBe('dry-run');
    expect(result.updated).toBe(1);
    expect(result.synced).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'nih-pi-sarah-fineberg',
          field: 'name',
          from: RUNON_NAME,
          to: 'Fineberg Lab',
        }),
      ]),
    );

    expect(vi.mocked(syncEntity)).not.toHaveBeenCalled();
    const stored = await ResearchEntity.findOne({ slug: 'nih-pi-sarah-fineberg' }).lean<{
      name: string;
      displayName: string;
    }>();
    expect(stored?.name).toBe(RUNON_NAME);
    expect(stored?.displayName).toBe(RUNON_DISPLAY_NAME);
  });

  it('strips the run-on from name and displayName and re-syncs the fixed doc on apply', async () => {
    await createEntity({
      slug: 'nih-pi-sarah-fineberg',
      name: RUNON_NAME,
      displayName: RUNON_DISPLAY_NAME,
    });
    await createEntity({ slug: 'clean-lab', name: 'Clean Lab', displayName: 'Clean Lab' });

    const result = await runResearchEntityNameRunonBackfill({ dryRun: false });

    expect(result.mode).toBe('apply');
    expect(result.updated).toBe(1);
    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);

    const fixed = await ResearchEntity.findOne({ slug: 'nih-pi-sarah-fineberg' }).lean<{
      name: string;
      displayName: string;
    }>();
    expect(fixed?.name).toBe('Fineberg Lab');
    expect(fixed?.displayName).toBe('Fineberg Lab');

    const untouched = await ResearchEntity.findOne({ slug: 'clean-lab' }).lean<{
      name: string;
    }>();
    expect(untouched?.name).toBe('Clean Lab');

    expect(vi.mocked(syncEntity)).toHaveBeenCalledTimes(1);
    const [entityType, syncedDoc] = vi.mocked(syncEntity).mock.calls[0];
    expect(entityType).toBe('researchEntity');
    expect((syncedDoc as { name: string }).name).toBe('Fineberg Lab');
    expect((syncedDoc as { displayName: string }).displayName).toBe('Fineberg Lab');
  });

  it('converges to zero updates on a second apply run (idempotent)', async () => {
    await createEntity({
      slug: 'nih-pi-sarah-fineberg',
      name: RUNON_NAME,
      displayName: RUNON_DISPLAY_NAME,
    });

    const first = await runResearchEntityNameRunonBackfill({ dryRun: false });
    expect(first.updated).toBe(1);

    vi.mocked(syncEntity).mockClear();
    const second = await runResearchEntityNameRunonBackfill({ dryRun: false });

    expect(second.scanned).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.synced).toBe(0);
    expect(vi.mocked(syncEntity)).not.toHaveBeenCalled();
  });

  it('honors an explicit limit, fixing only the first matching entity', async () => {
    await createEntity({ slug: 'runon-a', name: RUNON_NAME });
    await createEntity({ slug: 'runon-b', name: RUNON_NAME });

    const result = await runResearchEntityNameRunonBackfill({ dryRun: false, limit: 1 });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);

    const remaining = await ResearchEntity.countDocuments({
      name: RUNON_NAME,
    });
    expect(remaining).toBe(1);
  });
});
