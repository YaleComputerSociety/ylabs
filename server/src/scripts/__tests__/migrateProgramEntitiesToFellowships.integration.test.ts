import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { parseArgs, runMigration } from '../migrateProgramEntitiesToFellowships';

let memoryReplSet: MongoMemoryReplSet | undefined;

const insertProgramEntity = async (overrides: Record<string, unknown>) => {
  const db = mongoose.connection.db!;
  const _id = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id,
    entityType: 'PROGRAM',
    kind: 'program',
    ...overrides,
  });
  return _id;
};

describe('migrateProgramEntitiesToFellowships CLI parsing', () => {
  it('defaults to a dry-run and requires the confirmation flag semantics', () => {
    expect(parseArgs([])).toEqual({ dryRun: true, confirm: false });
    expect(parseArgs(['--apply', '--confirm-program-entity-migration'])).toEqual({
      dryRun: false,
      confirm: true,
    });
    expect(parseArgs(['--limit=5'])).toMatchObject({ limit: 5 });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('migrateProgramEntitiesToFellowships with MongoDB', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('program_migration_test'));
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('performs no writes in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    await insertProgramEntity({
      slug: 'department-undergrad-research-chemistry',
      name: 'Chemistry Undergraduate Research',
      fullDescription: 'Undergraduate research in chemistry.',
    });

    const result = await runMigration({ dryRun: true, confirm: false });

    expect(result.mode).toBe('dry-run');
    expect(result.summary.programEntities).toBe(1);
    expect(result.summary.researchEntitiesDeleted).toBe(0);
    await expect(
      db.collection('research_entities').countDocuments({ entityType: 'PROGRAM' }),
    ).resolves.toBe(1);
    await expect(db.collection('fellowships').countDocuments()).resolves.toBe(0);
  });

  it('moves a department undergrad research program to a research-focused fellowship and frees the corpus', async () => {
    const db = mongoose.connection.db!;
    const entityId = await insertProgramEntity({
      slug: 'department-undergrad-research-astronomy',
      name: 'Astronomy Undergraduate Research',
      fullDescription: 'Undergraduate students conduct research under a faculty member.',
      shortDescription: 'Astronomy undergraduate research opportunities.',
      officialUrl: 'https://astronomy.yale.edu/undergraduate/research',
      joinPageUrl: 'https://astronomy.yale.edu/apply',
      departments: ['Astronomy'],
    });
    await db.collection('signals').insertMany([
      { _id: new mongoose.Types.ObjectId(), researchEntityId: entityId, type: 'x' },
      { _id: new mongoose.Types.ObjectId(), researchEntityId: entityId, type: 'y' },
    ]);
    await db.collection('role_assignments').insertOne({
      _id: new mongoose.Types.ObjectId(),
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      archived: false,
    });

    const result = await runMigration({ dryRun: false, confirm: true });

    expect(result.mode).toBe('apply');
    expect(result.summary.fellowshipsCreated).toBe(1);
    expect(result.summary.researchEntitiesDeleted).toBe(1);
    expect(result.summary.signalsDeleted).toBe(2);
    expect(result.summary.roleAssignmentsArchived).toBe(1);

    const fellowship = await db
      .collection('fellowships')
      .findOne({ sourceKey: 'department-undergrad-research-astronomy' });
    expect(fellowship).toBeTruthy();
    expect(fellowship?.title).toBe('Astronomy Undergraduate Research');
    expect(fellowship?.researchFocused).toBe(true);
    expect(fellowship?.undergraduateOnly).toBe(true);
    expect(fellowship?.applicationLink).toBe('https://astronomy.yale.edu/apply');

    await expect(
      db.collection('research_entities').countDocuments({ entityType: 'PROGRAM' }),
    ).resolves.toBe(0);
    await expect(db.collection('signals').countDocuments()).resolves.toBe(0);
    const roleAssignment = await db.collection('role_assignments').findOne({});
    expect(roleAssignment?.archived).toBe(true);
  });

  it('dedupes against an existing fellowship with a matching title and still deletes the program entity', async () => {
    const db = mongoose.connection.db!;
    await db.collection('fellowships').insertOne({
      _id: new mongoose.Types.ObjectId(),
      sourceKey: 'existing-source-key',
      title: 'Global Health Scholars',
    });
    await insertProgramEntity({
      slug: 'department-undergrad-research-global-health',
      name: 'Global Health Scholars',
      fullDescription: 'A duplicate of an existing fellowship by title.',
    });

    const result = await runMigration({ dryRun: false, confirm: true });

    expect(result.summary.dedupedAgainstExisting).toBe(1);
    expect(result.summary.fellowshipsCreated).toBe(0);
    await expect(db.collection('fellowships').countDocuments()).resolves.toBe(1);
    await expect(
      db.collection('research_entities').countDocuments({ entityType: 'PROGRAM' }),
    ).resolves.toBe(0);
  });

  it('does not mark non-department programs as research-focused', async () => {
    const db = mongoose.connection.db!;
    await insertProgramEntity({
      slug: 'summer-language-institute',
      name: 'Summer Language Institute',
      fullDescription: 'An intensive language program.',
    });

    await runMigration({ dryRun: false, confirm: true });

    const fellowship = await db
      .collection('fellowships')
      .findOne({ sourceKey: 'summer-language-institute' });
    expect(fellowship?.researchFocused).toBe(false);
  });
});
