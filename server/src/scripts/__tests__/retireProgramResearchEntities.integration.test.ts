import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseRetireProgramResearchEntitiesArgs,
  assertRetireProgramResearchEntitiesApplyAllowed,
  retireProgramResearchEntities,
} from '../retireProgramResearchEntities';
import {
  buildRetireProgramResearchEntitiesPlan,
  RETIRED_RESEARCH_ENTITY_TYPES,
} from '../retireProgramResearchEntitiesCore';
import { researchEntityTypes } from '../../models/researchAccessTypes';

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

  it('counts every retired entity type it scans, not just PROGRAM (#2202)', () => {
    const plan = buildRetireProgramResearchEntitiesPlan({
      candidates: [
        { id: 'a', slug: 'p-a', entityType: 'PROGRAM' },
        { id: 'b', slug: 'c-b', entityType: 'COLLECTIONS_INITIATIVE' },
        { id: 'c', slug: 'c-c', entityType: 'COLLECTIONS_INITIATIVE' },
        { id: 'd', slug: 'a-d', entityType: 'ARCHIVE_OR_MUSEUM_PROJECT', archived: true },
        { id: 'e', slug: 's-e', entityType: 'COURSE_SEQUENCE' },
      ],
    });

    expect(plan.byEntityType).toEqual({
      PROGRAM: 1,
      COLLECTIONS_INITIATIVE: 2,
      ARCHIVE_OR_MUSEUM_PROJECT: 1,
      COURSE_SEQUENCE: 1,
    });
    expect(plan.toArchive).toEqual(['a', 'b', 'c', 'e']);
    expect(plan.alreadyArchived).toBe(1);
  });

  it('covers every value retired from the researchEntityTypes enum', () => {
    expect([...RETIRED_RESEARCH_ENTITY_TYPES]).toEqual([
      'PROGRAM',
      'COLLECTIONS_INITIATIVE',
      'ARCHIVE_OR_MUSEUM_PROJECT',
      'DIGITAL_HUMANITIES_PROJECT',
      'COURSE_SEQUENCE',
      'GROUP',
    ]);
    for (const retired of RETIRED_RESEARCH_ENTITY_TYPES) {
      expect(researchEntityTypes as readonly string[]).not.toContain(retired);
    }
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

  let deleteDocuments: ReturnType<typeof vi.fn>;
  let getIndex: any;

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'fellowships', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    deleteDocuments = vi.fn().mockResolvedValue(undefined);
    getIndex = vi.fn().mockResolvedValue({ deleteDocuments });
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

    const result = await retireProgramResearchEntities({
      apply: false,
      confirmProgramEntityRetirement: false,
      getIndex,
    });

    expect(result.mode).toBe('dry-run');
    expect(result.plan.toArchiveCount).toBe(1);
    expect(result.archivedResearchEntities).toBe(0);
    expect(result.search).toMatchObject({ requested: 0, deleted: false });
    expect(getIndex).not.toHaveBeenCalled();
    const doc = await db.collection('research_entities').findOne({ slug: 'program-residue-one' });
    expect(doc?.archived).toBeFalsy();
  });

  it('refuses to archive without the confirmation flag even when called directly', async () => {
    await insertProgramEntity({ slug: 'program-residue-one', name: 'Program Residue One' });

    await expect(
      retireProgramResearchEntities({
        apply: true,
        confirmProgramEntityRetirement: false,
        getIndex,
      }),
    ).rejects.toThrow(/--confirm-program-entity-retirement is required/);

    const doc = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ slug: 'program-residue-one' });
    expect(doc?.archived).toBeFalsy();
    expect(getIndex).not.toHaveBeenCalled();
  });

  it('enforces the max-apply cap against the plan it is about to apply', async () => {
    await insertProgramEntity({ slug: 'program-residue-one', name: 'Program Residue One' });
    await insertProgramEntity({ slug: 'program-residue-two', name: 'Program Residue Two' });

    await expect(
      retireProgramResearchEntities({
        apply: true,
        confirmProgramEntityRetirement: true,
        maxApply: 1,
        getIndex,
      }),
    ).rejects.toThrow(/above --max-apply/);

    await expect(
      mongoose.connection.db!.collection('research_entities').countDocuments({ archived: true }),
    ).resolves.toBe(0);
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

    const result = await retireProgramResearchEntities({
      apply: true,
      confirmProgramEntityRetirement: true,
      getIndex,
    });

    expect(result.mode).toBe('apply');
    expect(result.archivedResearchEntities).toBe(1);
    expect(result.search).toMatchObject({ requested: 1, deleted: true });
    expect(result.plan.withFellowship).toBe(1);
    expect(deleteDocuments).toHaveBeenCalledWith(result.plan.toArchive);

    await expect(
      db
        .collection('research_entities')
        .countDocuments({ entityType: 'PROGRAM', archived: { $ne: true } }),
    ).resolves.toBe(0);
    await expect(
      db.collection('research_entities').countDocuments({ entityType: 'PROGRAM' }),
    ).resolves.toBe(2);
  });

  it('reports a failed search deletion instead of claiming the index is clean', async () => {
    await insertProgramEntity({ slug: 'program-residue-one', name: 'Program Residue One' });
    deleteDocuments.mockRejectedValue(new Error('meili unreachable'));

    const result = await retireProgramResearchEntities({
      apply: true,
      confirmProgramEntityRetirement: true,
      getIndex,
    });

    expect(result.archivedResearchEntities).toBe(1);
    expect(result.search.requested).toBe(1);
    expect(result.search.deleted).toBe(false);
    expect(result.search.error).toContain('meili unreachable');
  });
});
