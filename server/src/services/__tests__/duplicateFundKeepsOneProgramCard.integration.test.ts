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
  planStudentVisibilityGate,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const OFFICE_COPY_ID = new mongoose.Types.ObjectId('000000000000000000003988');
const CATALOG_COPY_ID = new mongoose.Types.ObjectId('000000000000000000003989');
const DESCRIPTION =
  'The fixture travel fellowship supports Yale undergraduates who plan summer research projects abroad under faculty guidance.';

const fundRow = (overrides: Record<string, unknown>) => ({
  title: 'Fixture Travel Research Fellowship',
  description: DESCRIPTION,
  summary: DESCRIPTION,
  programKind: 'FELLOWSHIP_FUNDING',
  studentFacingCategory: 'Fellowship or grant',
  purpose: ['Research'],
  yearOfStudy: ['Junior'],
  undergraduateOnly: true,
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

let memoryServer: MongoMemoryServer | undefined;
let plans: StudentVisibilityGatePlan[] = [];

const planFor = (id: mongoose.Types.ObjectId, from = plans): StudentVisibilityGatePlan => {
  const plan = from.find((candidate) => candidate.recordId === String(id));
  if (!plan) throw new Error(`no gate plan for ${String(id)}`);
  return plan;
};

describe('one fund reached through two fund-page URLs serves one program card (#3988)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('duplicate_fund_program_card_test'));
    await mongoose.connection.db!.collection('fellowships').insertMany([
      fundRow({
        _id: OFFICE_COPY_ID,
        sourceName: 'yale-college-fellowships-office',
        sourceKey: 'fixture-office-copy',
        sourceUrl: 'https://funding.example.edu/fellowships',
        applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?4F4646494345',
      }),
      fundRow({
        _id: CATALOG_COPY_ID,
        sourceName: 'student-grants-database',
        sourceKey: 'fixture-catalog-copy',
        sourceUrl: 'https://department.example.edu/fellowships',
        applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?434154414C4F47',
      }),
    ]);
    plans = await planStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('serves the database copy and suppresses the other lane copy as a duplicate (#4289)', () => {
    expect(planFor(CATALOG_COPY_ID).tier).toBe('student_ready');
    expect(planFor(CATALOG_COPY_ID).reasons).not.toContain('duplicate_program');
    expect(planFor(OFFICE_COPY_ID).tier).toBe('suppressed');
    expect(planFor(OFFICE_COPY_ID).reasons).toContain('duplicate_program');
  });

  it('reaches the same verdict when the gate is run over one record', async () => {
    const targeted = await planStudentVisibilityGate({
      collection: 'programs',
      mode: 'dry-run',
      recordIds: [String(OFFICE_COPY_ID)],
    });
    expect(targeted.map((plan) => plan.recordId).sort()).toEqual(
      [String(OFFICE_COPY_ID), String(CATALOG_COPY_ID)].sort(),
    );
    expect(planFor(OFFICE_COPY_ID, targeted).tier).toBe('suppressed');
    expect(planFor(CATALOG_COPY_ID, targeted).tier).toBe('student_ready');
  });

  it('still serves exactly one copy after the verdict is applied and the gate runs again', async () => {
    await applyStudentVisibilityGatePlans(plans);
    const rerun = await planStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });
    const served = rerun.filter((plan) => plan.tier === 'student_ready');
    expect(served.map((plan) => plan.recordId)).toEqual([String(CATALOG_COPY_ID)]);
  });
});
