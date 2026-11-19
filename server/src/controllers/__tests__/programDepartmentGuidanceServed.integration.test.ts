import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { getProgramById, searchProgramsController } from '../programController';

const RESEARCH_GUIDE_URL = 'https://fixture.yale.edu/undergraduate/undergraduate-research';
const SENIOR_ESSAY_GUIDE_URL = 'https://fixture.yale.edu/undergraduate/senior-essay';

const servedGuideFields = {
  summary: 'A synthetic department page used to exercise served department guidance.',
  sourceName: 'department-undergrad-research',
  archived: false,
  studentVisibilityTier: 'student_ready',
  entryMode: 'CONTACT_FACULTY',
  undergraduateOnly: true,
} as const;

const seedGuides = async () => {
  const research = await Fellowship.create({
    ...servedGuideFields,
    title: 'Fixture Sciences Undergraduate Research',
    programKind: 'DEPARTMENT_RESEARCH_GUIDE',
    studentFacingCategory: 'Department research guidance',
    sourcePageTitle: 'Undergraduate Research',
    sourceUrl: RESEARCH_GUIDE_URL,
    applicationLink: RESEARCH_GUIDE_URL,
  } as const);
  const seniorEssay = await Fellowship.create({
    ...servedGuideFields,
    title: 'Fixture Humanities Senior Essay',
    programKind: 'DEPARTMENT_SENIOR_ESSAY_GUIDE',
    studentFacingCategory: 'Senior essay guidance',
    sourcePageTitle: 'The Senior Essay',
    sourceUrl: SENIOR_ESSAY_GUIDE_URL,
    applicationLink: SENIOR_ESSAY_GUIDE_URL,
  } as const);
  return { research, seniorEssay };
};

const mockResponse = () =>
  ({
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }) as any;

const searchAsStudent = async () => {
  const response = mockResponse();
  await searchProgramsController({ query: {}, user: undefined } as any, response);
  const [payload] = response.json.mock.calls[0];
  return payload.results as Array<Record<string, unknown>>;
};

const readAsStudent = async (id: string) => {
  const response = mockResponse();
  const next = vi.fn();
  await getProgramById({ params: { id }, user: undefined } as any, response, next);
  expect(next).not.toHaveBeenCalled();
  const [payload] = response.json.mock.calls[0];
  return payload.program as Record<string, unknown>;
};

describe('served department guidance kinds on the student routes (#5298, integration)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(async () => {
    await Fellowship.deleteMany({});
  });

  it('serves both guidance kinds from search as guidance, each with its own kind', async () => {
    await seedGuides();

    const results = await searchAsStudent();
    const byUrl = new Map(results.map((program) => [program.sourceUrl, program]));

    expect(byUrl.get(RESEARCH_GUIDE_URL)).toMatchObject({
      departmentResearchGuidance: true,
      departmentGuidanceKind: 'research',
    });
    expect(byUrl.get(SENIOR_ESSAY_GUIDE_URL)).toMatchObject({
      programKind: 'DEPARTMENT_SENIOR_ESSAY_GUIDE',
      departmentResearchGuidance: true,
      departmentGuidanceKind: 'senior_essay',
    });
    for (const program of results) expect(program.applicationLink).toBeUndefined();
  });

  it('serves the senior essay kind on the detail route with no application link', async () => {
    const { seniorEssay } = await seedGuides();

    const program = await readAsStudent(String(seniorEssay._id));

    expect(program).toMatchObject({
      departmentResearchGuidance: true,
      departmentGuidanceKind: 'senior_essay',
      sourceUrl: SENIOR_ESSAY_GUIDE_URL,
    });
    expect(program.applicationLink).toBeUndefined();
  });
});
