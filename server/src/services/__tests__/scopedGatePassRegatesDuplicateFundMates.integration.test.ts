import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../meiliSyncService', () => ({
  syncEntities: vi.fn(async () => 0),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
  readIndexedFieldByDocumentId: vi.fn(async () => new Map()),
}));

import {
  applyStudentVisibilityGatePlans,
  duplicateProgramFundMateIds,
  planStudentVisibilityGate,
} from '../studentVisibilityGateService';
import { readProgram } from '../programService';

const OFFICE_COPY_ID = new mongoose.Types.ObjectId('000000000000000000004699');
const DEPARTMENT_COPY_ID = new mongoose.Types.ObjectId('000000000000000000004700');
const PROGRAM_PAGE =
  'https://engineering.example.yale.edu/fixture-department/undergraduate-research';
const APPLICATION_FORM = 'https://forms.gle/FixtureForm4699';
const OFFICE_SOURCE = 'yale-college-fellowships-office';
const DEPARTMENT_SOURCE = 'department-undergrad-research';
const SEEDED_AT = new Date('2026-01-02T00:00:00.000Z');

const fundCopy = (overrides: Record<string, unknown>) => ({
  title: 'Fixture Research Internship Program',
  programCategory: 'RECURRING_PROGRAM',
  programRole: 'STARTS_RESEARCH',
  researchFocused: true,
  undergraduateOnly: true,
  archived: false,
  sourceUrl: PROGRAM_PAGE,
  studentVisibilityComputedAt: SEEDED_AT,
  ...overrides,
});

const servedCopyIds = async (): Promise<string[]> => {
  const served: string[] = [];
  for (const id of [OFFICE_COPY_ID, DEPARTMENT_COPY_ID]) {
    try {
      await readProgram(String(id));
      served.push(String(id));
    } catch {
      continue;
    }
  }
  return served;
};

let memoryServer: MongoMemoryServer | undefined;

describe('a scoped program gate pass re-gates every copy of a duplicated fund (#4699)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('scoped_gate_regates_fund_mates_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    const programs = mongoose.connection.db!.collection('fellowships');
    await programs.deleteMany({});
    await programs.insertMany([
      fundCopy({
        _id: OFFICE_COPY_ID,
        sourceName: OFFICE_SOURCE,
        sourceKey: 'fixture-office-copy',
        programKind: 'STRUCTURED_PROGRAM',
        entryMode: 'APPLY_TO_PROGRAM',
        studentFacingCategory: 'Internship program',
        purpose: ['Research'],
        termOfAward: ['Summer'],
        isAcceptingApplications: true,
        applicationLink: APPLICATION_FORM,
        links: [{ label: 'Apply Now', url: APPLICATION_FORM }],
        description: '',
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: [
          'official_source',
          'application_route',
          'undergraduate_relevant',
        ],
      }),
      fundCopy({
        _id: DEPARTMENT_COPY_ID,
        sourceName: DEPARTMENT_SOURCE,
        sourceKey: 'fixture-department-copy',
        title: 'Fixture Department Research Internship Program',
        programKind: 'MENTOR_MATCHING',
        entryMode: 'DIRECT_FACULTY_MATCHING',
        studentFacingCategory: 'Faculty matching program',
        mentorMatching: true,
        isAcceptingApplications: false,
        applicationLink: APPLICATION_FORM.replace('https:', 'http:'),
        description:
          'Juniors propose a summer research project with a faculty sponsor, submit a short budget, and present their findings to the department in the fall.',
        studentVisibilityTier: 'suppressed',
        studentVisibilityReasons: [
          'official_source',
          'application_route',
          'undergraduate_relevant',
          'duplicate_program',
        ],
      }),
    ]);
  });

  it('still serves one copy after a pass scoped to the copy that stopped being the kept one', async () => {
    expect(await servedCopyIds()).toEqual([String(OFFICE_COPY_ID)]);

    const plans = await planStudentVisibilityGate({
      collection: 'programs',
      mode: 'apply',
      sourceName: OFFICE_SOURCE,
    });
    await applyStudentVisibilityGatePlans(plans);

    expect(plans.map((plan) => plan.recordId).sort()).toEqual(
      [String(OFFICE_COPY_ID), String(DEPARTMENT_COPY_ID)].sort(),
    );
    expect(await servedCopyIds()).toEqual([String(DEPARTMENT_COPY_ID)]);
  });

  it('re-gates the fund mates of a pass scoped by record id', async () => {
    const plans = await planStudentVisibilityGate({
      collection: 'programs',
      mode: 'apply',
      recordIds: [String(OFFICE_COPY_ID)],
    });
    await applyStudentVisibilityGatePlans(plans);

    expect(await servedCopyIds()).toEqual([String(DEPARTMENT_COPY_ID)]);
  });

  it('re-gates a copy whose stored duplicate suppression no longer has a fund to duplicate', async () => {
    await mongoose.connection
      .db!.collection('fellowships')
      .updateOne({ _id: OFFICE_COPY_ID }, { $set: { archived: true } });

    const plans = await planStudentVisibilityGate({
      collection: 'programs',
      mode: 'apply',
      sourceName: OFFICE_SOURCE,
    });
    await applyStudentVisibilityGatePlans(plans);

    expect(await servedCopyIds()).toEqual([String(DEPARTMENT_COPY_ID)]);
  });
});

describe('duplicateProgramFundMateIds', () => {
  const keptCopyById = new Map([
    ['copy-b', 'kept-a'],
    ['copy-c', 'kept-a'],
    ['copy-e', 'kept-d'],
  ]);

  it('returns every other member of a scoped copy fund, kept copy included', () => {
    expect(duplicateProgramFundMateIds(['copy-b'], keptCopyById)).toEqual(['copy-c', 'kept-a']);
  });

  it('returns the suppressed copies when the scoped row is the kept copy', () => {
    expect(duplicateProgramFundMateIds(['kept-d'], keptCopyById)).toEqual(['copy-e']);
  });

  it('returns nothing for a program that belongs to no duplicate fund', () => {
    expect(duplicateProgramFundMateIds(['lone-fund'], keptCopyById)).toEqual([]);
  });
});
