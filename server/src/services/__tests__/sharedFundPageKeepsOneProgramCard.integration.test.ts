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
  planStudentVisibilityGate,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const OFFICE_COPY_ID = new mongoose.Types.ObjectId('000000000000000000004289');
const DATABASE_COPY_ID = new mongoose.Types.ObjectId('000000000000000000004290');
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?46495854555245';

const fundRow = (overrides: Record<string, unknown>) => ({
  title: 'Fixture Travel Research Fellowship',
  programKind: 'FELLOWSHIP_FUNDING',
  studentFacingCategory: 'Fellowship or grant',
  purpose: ['Research'],
  yearOfStudy: ['Junior'],
  undergraduateOnly: true,
  archived: false,
  ...overrides,
});

let memoryServer: MongoMemoryServer | undefined;
let plans: StudentVisibilityGatePlan[] = [];

const planFor = (id: mongoose.Types.ObjectId): StudentVisibilityGatePlan => {
  const plan = plans.find((candidate) => candidate.recordId === String(id));
  if (!plan) throw new Error(`no gate plan for ${String(id)}`);
  return plan;
};

describe('two copies citing one fund page serve one program card (#4289)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('shared_fund_page_program_card_test'));
    await mongoose.connection.db!.collection('fellowships').insertMany([
      fundRow({
        _id: OFFICE_COPY_ID,
        sourceName: 'yale-college-fellowships-office',
        sourceKey: 'fixture-office-copy',
        sourceUrl: 'https://catalog.example.edu/fellowships-and-grants',
        description:
          'A short catalog summary of the fixture travel fellowship for undergraduates who research abroad over the summer.',
        applicationLink: FUND_PAGE,
        links: [{ label: 'Application', url: FUND_PAGE }],
      }),
      fundRow({
        _id: DATABASE_COPY_ID,
        sourceName: 'student-grants-database',
        sourceKey: 'fixture-database-copy',
        sourceUrl: FUND_PAGE,
        description:
          'The fund page describes the fellowship in full: eligible juniors propose a project with a faculty sponsor, submit a budget, and report on their findings in the fall after travel.',
        applicationLink: FUND_PAGE,
      }),
    ]);
    plans = await planStudentVisibilityGate({ collection: 'programs', mode: 'dry-run' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('serves the database record and suppresses the other copy as a duplicate', () => {
    const duplicates = [planFor(OFFICE_COPY_ID), planFor(DATABASE_COPY_ID)].filter((plan) =>
      plan.reasons.includes('duplicate_program'),
    );
    expect(duplicates.map((plan) => plan.recordId)).toEqual([String(OFFICE_COPY_ID)]);
    expect(planFor(DATABASE_COPY_ID).reasons).not.toContain('duplicate_program');
  });
});
