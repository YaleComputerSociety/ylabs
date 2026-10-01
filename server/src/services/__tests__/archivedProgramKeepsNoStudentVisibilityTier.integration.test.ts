import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { applyStudentVisibilityGatePlans } from '../studentVisibilityGateService';
import { archiveFellowship, unarchiveFellowship } from '../fellowshipService';
import { computeProgramStudentVisibility } from '../studentVisibilityTier';

const id = (hex: string) => new mongoose.Types.ObjectId(hex);

const SUBJECTS = {
  archivedStudentReady: id('000000000000000000003753'),
  liveStudentReady: id('000000000000000000003754'),
};

const staleStudentReadyVerdict = {
  studentVisibilityTier: 'student_ready',
  studentVisibilityComputedTier: 'student_ready',
  studentVisibilityReasons: ['official_source', 'application_route', 'undergraduate_relevant'],
  studentVisibilityComputedAt: new Date('2026-01-01T00:00:00Z'),
  studentVisibilityEvaluatedAt: new Date('2026-01-02T00:00:00Z'),
};

const seedRows = () => [
  {
    _id: SUBJECTS.archivedStudentReady,
    title: 'Example Undergraduate Research Program',
    archived: true,
    ...staleStudentReadyVerdict,
    studentVisibilitySuppressionReason: 'operator_note',
  },
  {
    _id: SUBJECTS.liveStudentReady,
    title: 'Example Summer Research Program',
    archived: false,
    ...staleStudentReadyVerdict,
  },
];

const rawRow = async (documentId: mongoose.Types.ObjectId) =>
  mongoose.connection.db!.collection('fellowships').findOne({ _id: documentId });

let memoryServer: MongoMemoryServer | undefined;

describe('an archived program stores no student-visibility verdict (#3753)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('archived_program_visibility_verdict_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    const collection = mongoose.connection.db!.collection('fellowships');
    await collection.deleteMany({});
    await collection.insertMany(seedRows() as any[]);
  });

  it('withdraws the verdict a gate apply never re-plans, keeping operator intent', async () => {
    await applyStudentVisibilityGatePlans([]);

    const archived = await rawRow(SUBJECTS.archivedStudentReady);
    expect(archived).not.toHaveProperty('studentVisibilityTier');
    expect(archived).not.toHaveProperty('studentVisibilityComputedTier');
    expect(archived).not.toHaveProperty('studentVisibilityReasons');
    expect(archived).not.toHaveProperty('studentVisibilityComputedAt');
    expect(archived).not.toHaveProperty('studentVisibilityEvaluatedAt');
    expect(archived?.studentVisibilitySuppressionReason).toBe('operator_note');

    const live = await rawRow(SUBJECTS.liveStudentReady);
    expect(live?.studentVisibilityTier).toBe('student_ready');
  });

  it('withdraws the verdict in the same write that archives a program', async () => {
    await archiveFellowship(SUBJECTS.liveStudentReady.toHexString());

    const row = await rawRow(SUBJECTS.liveStudentReady);
    expect(row?.archived).toBe(true);
    expect(row).not.toHaveProperty('studentVisibilityTier');
    expect(row).not.toHaveProperty('studentVisibilityReasons');
  });

  it('re-gates a restored program instead of serving the verdict it held before archiving', async () => {
    const restored = await unarchiveFellowship(SUBJECTS.archivedStudentReady.toHexString());

    const row = await rawRow(SUBJECTS.archivedStudentReady);
    const expected = computeProgramStudentVisibility(
      (await Fellowship.findById(SUBJECTS.archivedStudentReady).lean()) as any,
    );
    expect(row?.archived).toBe(false);
    expect(expected.tier).not.toBe('student_ready');
    expect(row?.studentVisibilityTier).toBe(expected.tier);
    expect(row?.studentVisibilityReasons).toEqual(expected.reasons);
    expect(restored.studentVisibilityTier).toBe(expected.tier);
  });
});
