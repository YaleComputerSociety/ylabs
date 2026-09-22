import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { archivedEntityUpdate } from '../../models/entityArchival';
import { applyStudentVisibilityGatePlans } from '../studentVisibilityGateService';
import {
  readArchivedVerdictCensus,
  repairArchivedStudentVisibilityVerdicts,
} from '../../scripts/repairArchivedStudentVisibilityVerdicts';

const id = (hex: string) => new mongoose.Types.ObjectId(hex);

const SUBJECTS = {
  archivedStudentReady: id('000000000000000000002896'),
  archivedHeldWithoutBlocker: id('000000000000000000002897'),
  liveStudentReady: id('000000000000000000002898'),
  liveHeldWithBlocker: id('000000000000000000002899'),
};

const seedRows = () => [
  {
    _id: SUBJECTS.archivedStudentReady,
    slug: 'archived-example-coastal-lab',
    name: 'Example Coastal Systems Laboratory',
    kind: 'lab',
    entityType: 'LAB',
    archived: true,
    canonicalGroupId: SUBJECTS.liveStudentReady,
    studentVisibilityTier: 'student_ready',
    studentVisibilityComputedTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    studentVisibilityComputedAt: new Date('2026-01-01T00:00:00Z'),
    studentVisibilityOverrideTier: 'student_ready',
    studentVisibilitySuppressionReason: 'merged_duplicate',
  },
  {
    _id: SUBJECTS.archivedHeldWithoutBlocker,
    slug: 'archived-example-sediment-lab',
    name: 'Example Sediment Transport Laboratory',
    kind: 'lab',
    entityType: 'LAB',
    archived: true,
    studentVisibilityTier: 'operator_review',
    studentVisibilityComputedTier: 'operator_review',
    studentVisibilityReasons: ['source_backed_description'],
    studentVisibilityComputedAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    _id: SUBJECTS.liveStudentReady,
    slug: 'live-example-coastal-lab',
    name: 'Example Coastal Systems Laboratory',
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityComputedTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    studentVisibilityComputedAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    _id: SUBJECTS.liveHeldWithBlocker,
    slug: 'live-example-shoreline-lab',
    name: 'Example Shoreline Adaptation Laboratory',
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    studentVisibilityTier: 'operator_review',
    studentVisibilityComputedTier: 'operator_review',
    studentVisibilityReasons: ['missing_card_description'],
    studentVisibilityComputedAt: new Date('2026-01-01T00:00:00Z'),
  },
];

const rawRow = async (documentId: mongoose.Types.ObjectId) =>
  mongoose.connection.db!.collection('research_entities').findOne({ _id: documentId });

let memoryServer: MongoMemoryServer | undefined;

describe('an archived row stores no student-visibility verdict (#2896)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('archived_visibility_verdict_test'));
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    const collection = mongoose.connection.db!.collection('research_entities');
    await collection.deleteMany({});
    await collection.insertMany(seedRows() as any[]);
  });

  it('reads a tier histogram that disagrees with itself until the corpus is repaired', async () => {
    const before = await readArchivedVerdictCensus();
    expect(before.archivedRowsStoringVerdict).toBe(2);
    expect(before.tierCounts).toEqual([
      { tier: 'student_ready', allRows: 2, liveRows: 1 },
      { tier: 'operator_review', allRows: 2, liveRows: 1 },
    ]);
    expect(before.heldRows.zeroHardBlockerAllRows).toBe(1);
    expect(before.heldRows.zeroHardBlockerLiveRows).toBe(0);
    expect(before.violations.length).toBeGreaterThan(0);

    const result = await repairArchivedStudentVisibilityVerdicts({ apply: true });
    expect(result.cleared).toBe(2);
    expect(result.after?.violations).toEqual([]);
    expect(result.after?.tierCounts).toEqual([
      { tier: 'student_ready', allRows: 1, liveRows: 1 },
      { tier: 'operator_review', allRows: 1, liveRows: 1 },
    ]);
    expect(result.after?.untieredRows).toEqual({ allRows: 2, liveRows: 0 });
    expect(result.after?.heldRows.zeroHardBlockerAllRows).toBe(0);
  });

  it('keeps operator intent on the archived row and leaves live rows untouched', async () => {
    await repairArchivedStudentVisibilityVerdicts({ apply: true });

    const archived = await rawRow(SUBJECTS.archivedStudentReady);
    expect(archived).not.toHaveProperty('studentVisibilityTier');
    expect(archived).not.toHaveProperty('studentVisibilityComputedTier');
    expect(archived).not.toHaveProperty('studentVisibilityReasons');
    expect(archived).not.toHaveProperty('studentVisibilityComputedAt');
    expect(archived?.studentVisibilityOverrideTier).toBe('student_ready');
    expect(archived?.studentVisibilitySuppressionReason).toBe('merged_duplicate');
    expect(archived?.canonicalGroupId).toEqual(SUBJECTS.liveStudentReady);

    const live = await rawRow(SUBJECTS.liveStudentReady);
    expect(live?.studentVisibilityTier).toBe('student_ready');
    expect(live?.studentVisibilityReasons).toEqual(['source_backed_description']);
  });

  it('withdraws the verdict in the same write that archives a row', async () => {
    await ResearchEntity.updateOne(
      { _id: SUBJECTS.liveStudentReady },
      archivedEntityUpdate({ canonicalGroupId: SUBJECTS.archivedStudentReady }),
    );

    const row = await rawRow(SUBJECTS.liveStudentReady);
    expect(row?.archived).toBe(true);
    expect(row).not.toHaveProperty('studentVisibilityTier');
    expect(row).not.toHaveProperty('studentVisibilityReasons');
  });

  it('reconciles the rows a gate apply never plans, because the planner skips archived rows', async () => {
    await applyStudentVisibilityGatePlans([]);

    expect(await rawRow(SUBJECTS.archivedStudentReady)).not.toHaveProperty('studentVisibilityTier');
    expect(await rawRow(SUBJECTS.archivedHeldWithoutBlocker)).not.toHaveProperty(
      'studentVisibilityTier',
    );
    expect((await readArchivedVerdictCensus()).violations).toEqual([]);
  });
});
