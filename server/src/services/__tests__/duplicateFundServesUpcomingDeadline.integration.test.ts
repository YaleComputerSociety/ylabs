import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../meiliSyncService', () => ({
  syncEntities: vi.fn(async () => 0),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
  readIndexedFieldByDocumentId: vi.fn(async () => new Map()),
}));

import {
  applyStudentVisibilityGatePlans,
  clearArchivedProgramStudentVisibility,
  planStudentVisibilityGate,
  runStudentVisibilityGate,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';
import { readFellowship } from '../fellowshipService';

const DATABASE_COPY_ID = new mongoose.Types.ObjectId('000000000000000000004382');
const OFFICE_COPY_ID = new mongoose.Types.ObjectId('000000000000000000004383');
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?46495854555246';
const PASSED_DEADLINE = new Date('2001-07-30T21:00:00.000Z');
const UPCOMING_DATE_ONLY = new Date('2099-01-05T04:59:59.999Z');

const fundRow = (overrides: Record<string, unknown>) => ({
  title: 'Fixture Research Fund',
  programKind: 'FELLOWSHIP_FUNDING',
  studentFacingCategory: 'Fellowship or grant',
  purpose: ['Research'],
  yearOfStudy: ['Junior'],
  undergraduateOnly: true,
  archived: false,
  description:
    'The fixture research fund supports Yale undergraduates who conduct mentored laboratory research during the academic year and the following summer.',
  applicationLink: FUND_PAGE,
  ...overrides,
});

let memoryServer: MongoMemoryServer | undefined;

const fellowships = () => mongoose.connection.db!.collection('fellowships');
const stored = async (id: mongoose.Types.ObjectId) => fellowships().findOne({ _id: id });
const planFor = (plans: StudentVisibilityGatePlan[], id: mongoose.Types.ObjectId) => {
  const plan = plans.find((candidate) => candidate.recordId === String(id));
  if (!plan) throw new Error(`no gate plan for ${String(id)}`);
  return plan;
};
const gate = () => planStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });

describe('a fund whose served database record lists a passed deadline (#4382)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('duplicate_fund_upcoming_deadline_test'));
    await fellowships().insertMany([
      fundRow({
        _id: DATABASE_COPY_ID,
        sourceName: 'student-grants-database',
        sourceKey: 'fixture-database-copy',
        sourceUrl: FUND_PAGE,
        isAcceptingApplications: false,
        applicationOpenDate: new Date('2001-06-05T04:00:00.000Z'),
        deadline: PASSED_DEADLINE,
      }),
      fundRow({
        _id: OFFICE_COPY_ID,
        title: 'Fixture Research Fund Program',
        sourceName: 'yale-college-fellowships-office',
        sourceKey: 'fixture-office-copy',
        sourceUrl: 'https://science.example.edu/fixture-research-fund',
        isAcceptingApplications: true,
        deadline: UPCOMING_DATE_ONLY,
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('keeps serving the database record and derives the hidden copy deadline for it', async () => {
    const plans = await gate();
    expect(planFor(plans, DATABASE_COPY_ID).tier).toBe('student_ready');
    expect(planFor(plans, OFFICE_COPY_ID).reasons).toContain('duplicate_program');
    expect(planFor(plans, DATABASE_COPY_ID).upcomingDuplicateWindow).toEqual({
      deadline: UPCOMING_DATE_ONLY,
      isAcceptingApplications: true,
      sourceProgramId: String(OFFICE_COPY_ID),
    });
    expect(planFor(plans, OFFICE_COPY_ID).upcomingDuplicateWindow).toBeNull();
  });

  it('stores the window on apply, writes no deadline, and serves the upcoming date', async () => {
    await applyStudentVisibilityGatePlans(await gate());
    const kept = await stored(DATABASE_COPY_ID);
    expect(kept?.deadline).toEqual(PASSED_DEADLINE);
    expect(kept?.upcomingDuplicateWindow).toEqual({
      deadline: UPCOMING_DATE_ONLY,
      isAcceptingApplications: true,
      sourceProgramId: OFFICE_COPY_ID,
    });
    expect((await stored(OFFICE_COPY_ID))?.upcomingDuplicateWindow).toBeUndefined();

    const served = await readFellowship(String(DATABASE_COPY_ID));
    expect(served.deadline).toEqual(UPCOMING_DATE_ONLY);
    expect(served.isAcceptingApplications).toBe(true);
  });

  it('plans no change when the gate runs again over the same rows', async () => {
    const rerun = await gate();
    expect(rerun.every((plan) => plan.currentTier === plan.tier)).toBe(true);
    const report = await runStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });
    expect(report.counts.upcomingDuplicateWindowsChanged).toBe(0);
  });

  it('clears the window on the next apply once the hidden copy no longer states an upcoming date', async () => {
    await fellowships().updateOne(
      { _id: OFFICE_COPY_ID },
      { $set: { deadline: new Date('2001-12-01T21:00:00.000Z') } },
    );
    const plans = await gate();
    expect(planFor(plans, DATABASE_COPY_ID).upcomingDuplicateWindow).toBeNull();
    await applyStudentVisibilityGatePlans(plans);
    expect(await stored(DATABASE_COPY_ID)).not.toHaveProperty('upcomingDuplicateWindow');
  });

  it('withdraws the window with the verdict when the kept copy is archived', async () => {
    await fellowships().updateOne(
      { _id: OFFICE_COPY_ID },
      { $set: { deadline: UPCOMING_DATE_ONLY } },
    );
    await runStudentVisibilityGate({ collection: 'programs', mode: 'apply' });
    expect((await stored(DATABASE_COPY_ID))?.upcomingDuplicateWindow).toBeDefined();

    await fellowships().updateOne(
      { _id: DATABASE_COPY_ID },
      { $set: { archived: true, archivedReason: 'fixture archive' } },
    );
    await clearArchivedProgramStudentVisibility();
    const archived = await stored(DATABASE_COPY_ID);
    expect(archived).not.toHaveProperty('upcomingDuplicateWindow');
    expect(archived).not.toHaveProperty('studentVisibilityTier');
  });
});
