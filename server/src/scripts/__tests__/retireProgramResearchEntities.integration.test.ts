import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, deleteFromIndex: meiliMocks.deleteFromIndex };
});

import {
  parseRetireProgramResearchEntitiesArgs,
  assertRetireProgramResearchEntitiesApplyAllowed,
  retireProgramResearchEntities,
} from '../retireProgramResearchEntities';
import { buildRetireProgramResearchEntitiesPlan } from '../retireProgramResearchEntitiesCore';

describe('retireProgramResearchEntities CLI parsing and guards', () => {
  it('defaults to a dry-run', () => {
    expect(parseRetireProgramResearchEntitiesArgs([])).toMatchObject({ apply: false });
  });

  it('parses apply and confirmation flags', () => {
    expect(
      parseRetireProgramResearchEntitiesArgs(['--apply', '--confirm-program-entity-retirement']),
    ).toMatchObject({ apply: true, confirmProgramEntityRetirement: true });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseRetireProgramResearchEntitiesArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('requires the confirmation flag when applying', () => {
    expect(() =>
      assertRetireProgramResearchEntitiesApplyAllowed({
        apply: true,
        confirmProgramEntityRetirement: false,
        maxApply: 100,
        plannedArchives: 3,
      }),
    ).toThrow(/--confirm-program-entity-retirement is required/);
  });

  it('refuses to apply beyond the max-apply cap', () => {
    expect(() =>
      assertRetireProgramResearchEntitiesApplyAllowed({
        apply: true,
        confirmProgramEntityRetirement: true,
        maxApply: 2,
        plannedArchives: 3,
      }),
    ).toThrow(/above --max-apply/);
  });
});

describe('buildRetireProgramResearchEntitiesPlan', () => {
  it('archives only non-archived rows and reports fellowship coverage', () => {
    const plan = buildRetireProgramResearchEntitiesPlan({
      candidates: [
        { id: 'a', slug: 'p-a', fellowshipMatchKey: 'sourceKey' },
        { id: 'b', slug: 'p-b' },
        { id: 'c', slug: 'p-c', archived: true, fellowshipMatchKey: 'title' },
      ],
    });
    expect(plan.scanned).toBe(3);
    expect(plan.toArchive).toEqual(['a', 'b']);
    expect(plan.toArchiveCount).toBe(2);
    expect(plan.alreadyArchived).toBe(1);
    expect(plan.withFellowship).toBe(2);
    expect(plan.withoutFellowship).toBe(1);
  });
});

describe('retireProgramResearchEntities with MongoDB', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('retire_program_entities_test'));
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'fellowships', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    meiliMocks.deleteFromIndex.mockClear();
  });

  const insertProgramEntity = async (overrides: Record<string, unknown>): Promise<void> => {
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertOne({
      _id: new mongoose.Types.ObjectId(),
      entityType: 'PROGRAM',
      kind: 'program',
      ...overrides,
    });
  };

  it('makes no writes in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    await insertProgramEntity({ slug: 'program-residue-one', name: 'Program Residue One' });

    const result = await retireProgramResearchEntities({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.plan.toArchiveCount).toBe(1);
    expect(result.archivedResearchEntities).toBe(0);
    expect(meiliMocks.deleteFromIndex).not.toHaveBeenCalled();
    const doc = await db
      .collection('research_entities')
      .findOne({ slug: 'program-residue-one' });
    expect(doc?.archived).toBeFalsy();
  });

  it('archives non-archived PROGRAM rows and removes their search documents on apply', async () => {
    const db = mongoose.connection.db!;
    await insertProgramEntity({ slug: 'program-residue-one', name: 'Program Residue One' });
    await insertProgramEntity({
      slug: 'program-residue-two',
      name: 'Program Residue Two',
      archived: true,
    });
    await db.collection('fellowships').insertOne({
      _id: new mongoose.Types.ObjectId(),
      sourceKey: 'program-residue-one',
      title: 'Program Residue One',
    });

    const result = await retireProgramResearchEntities({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.archivedResearchEntities).toBe(1);
    expect(result.searchDocumentsRemoved).toBe(1);
    expect(result.plan.withFellowship).toBe(1);
    expect(meiliMocks.deleteFromIndex).toHaveBeenCalledWith('researchEntity', expect.any(String));

    await expect(
      db.collection('research_entities').countDocuments({ entityType: 'PROGRAM', archived: { $ne: true } }),
    ).resolves.toBe(0);
    await expect(
      db.collection('research_entities').countDocuments({ entityType: 'PROGRAM' }),
    ).resolves.toBe(2);
  });
});
