import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  researchAreaFind: vi.fn(),
  studentProfileFindOne: vi.fn(),
  studentProfileFindOneAndUpdate: vi.fn(),
}));

vi.mock('../../models/researchArea', () => ({
  ResearchArea: { find: mocks.researchAreaFind },
}));

vi.mock('../../models/studentProfile', () => ({
  StudentProfile: {
    findOne: mocks.studentProfileFindOne,
    findOneAndUpdate: mocks.studentProfileFindOneAndUpdate,
  },
}));

import {
  getStudentResearchInterests,
  setStudentResearchInterests,
} from '../studentInterestProfileService';

const leanChain = <T>(value: T) => {
  const chain: any = { lean: async () => value };
  chain.select = () => chain;
  return chain;
};

const governedAreas = [
  { name: 'Machine Learning' },
  { name: 'Statistics' },
  { name: 'Cell Biology' },
];

beforeEach(() => {
  mocks.researchAreaFind.mockReset();
  mocks.studentProfileFindOne.mockReset();
  mocks.studentProfileFindOneAndUpdate.mockReset();
  mocks.researchAreaFind.mockReturnValue(leanChain(governedAreas));
});

describe('getStudentResearchInterests', () => {
  it('returns the stored interests and graduation year', async () => {
    mocks.studentProfileFindOne.mockReturnValue(
      leanChain({ researchInterests: ['Machine Learning'], graduationYear: 2027 }),
    );
    await expect(getStudentResearchInterests('Ab123')).resolves.toEqual({
      researchInterests: ['Machine Learning'],
      graduationYear: 2027,
    });
  });

  it('returns an empty signal when no profile exists', async () => {
    mocks.studentProfileFindOne.mockReturnValue(leanChain(null));
    await expect(getStudentResearchInterests('ab123')).resolves.toEqual({
      researchInterests: [],
      graduationYear: null,
    });
  });

  it('rejects an invalid netid', async () => {
    await expect(getStudentResearchInterests('!!')).rejects.toMatchObject({ status: 400 });
  });
});

describe('setStudentResearchInterests', () => {
  it('keeps only governed terms, canonicalizes casing, and dedupes', async () => {
    mocks.studentProfileFindOneAndUpdate.mockImplementation((_filter, update) =>
      leanChain({ ...update.$set }),
    );
    const result = await setStudentResearchInterests('ab123', {
      researchInterests: ['machine learning', 'MACHINE LEARNING', 'astrology', 'Statistics'],
      graduationYear: 2028,
    });
    expect(result.researchInterests).toEqual(['Machine Learning', 'Statistics']);
    expect(result.graduationYear).toBe(2028);
    const [, update] = mocks.studentProfileFindOneAndUpdate.mock.calls[0];
    expect(update.$set.researchInterests).toEqual(['Machine Learning', 'Statistics']);
  });

  it('caps the number of stored interests', async () => {
    mocks.researchAreaFind.mockReturnValue(
      leanChain(Array.from({ length: 40 }, (_, index) => ({ name: `Area ${index}` }))),
    );
    mocks.studentProfileFindOneAndUpdate.mockImplementation((_filter, update) =>
      leanChain({ ...update.$set }),
    );
    const result = await setStudentResearchInterests('ab123', {
      researchInterests: Array.from({ length: 40 }, (_, index) => `Area ${index}`),
    });
    expect(result.researchInterests).toHaveLength(15);
    expect(result.graduationYear).toBeNull();
  });

  it('rejects an out-of-range graduation year', async () => {
    await expect(
      setStudentResearchInterests('ab123', { graduationYear: 1200 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a non-array interests payload', async () => {
    await expect(
      setStudentResearchInterests('ab123', { researchInterests: 'machine learning' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
