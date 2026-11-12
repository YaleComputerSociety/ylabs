import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { searchFellowships } from '../fellowshipService';

const US = 'U.S. citizens are eligible';
const NON_US = 'Non-U.S. citizens are eligible';
const SOPHOMORE = 'Sophomore';
const SENIOR = 'Senior';

const program = (
  title: string,
  citizenshipStatus: string[] | undefined,
  yearOfStudy: string[] = [],
) => ({
  title,
  summary: `${title} summary about coastal ecology.`,
  description: `${title} description.`,
  archived: false,
  studentVisibilityTier: 'student_ready',
  yearOfStudy,
  ...(citizenshipStatus ? { citizenshipStatus } : {}),
});

const FIXTURES = [
  program('Fixture Alpha Open Grant', [US, NON_US], [SOPHOMORE]),
  program('Fixture Bravo Absent Grant', undefined, [SOPHOMORE]),
  program('Fixture Charlie International Grant', [NON_US], [SENIOR]),
  program('Fixture Delta Empty Grant', [], []),
  program('Fixture Echo Restricted Grant', [US], [SOPHOMORE]),
  program('Fixture Foxtrot Open Grant', [US, NON_US], []),
  program('Fixture Golf Absent Grant', undefined, [SENIOR]),
];

const SAYS_OPEN_TO_NON_US = new Set([
  'Fixture Alpha Open Grant',
  'Fixture Charlie International Grant',
  'Fixture Foxtrot Open Grant',
]);
const DOESNT_SAY = new Set([
  'Fixture Bravo Absent Grant',
  'Fixture Delta Empty Grant',
  'Fixture Golf Absent Grant',
]);

type SearchParams = Parameters<typeof searchFellowships>[0];

const titlesOf = (result: { fellowships: Array<{ title?: string }> }) =>
  result.fellowships.map((fellowship) => String(fellowship.title));

const allPages = async (params: SearchParams, pageSize: number) => {
  const titles: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await searchFellowships({ ...params, page, pageSize });
    titles.push(...titlesOf(result));
    if (titles.length >= result.total) return { titles, total: result.total };
  }
  throw new Error('pagination did not reach the reported total');
};

const expectStatedFirst = (titles: string[]) => {
  const firstDoesntSay = titles.findIndex((title) => DOESNT_SAY.has(title));
  const lastSays = titles.reduce(
    (last, title, index) => (DOESNT_SAY.has(title) ? last : index),
    -1,
  );
  if (firstDoesntSay !== -1) expect(lastSays).toBeLessThan(firstDoesntSay);
};

let memoryServer: MongoMemoryServer | undefined;

describe('the programs citizenship split (#5299)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('program_citizenship_counts_test'));
    await Fellowship.createIndexes();
    await Fellowship.insertMany(FIXTURES);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('serves the says-open programs first, then the ones that do not say, and drops the says-closed one', async () => {
    const result = await searchFellowships({
      citizenshipStatus: [NON_US],
      sortBy: 'title',
      pageSize: 50,
    });
    expect(titlesOf(result)).toEqual([
      'Fixture Alpha Open Grant',
      'Fixture Charlie International Grant',
      'Fixture Foxtrot Open Grant',
      'Fixture Bravo Absent Grant',
      'Fixture Delta Empty Grant',
      'Fixture Golf Absent Grant',
    ]);
    expect(titlesOf(result)).not.toContain('Fixture Echo Restricted Grant');
    expect(result.citizenshipCounts?.selected).toEqual({ says: 3, doesntSay: 3 });
    expect(result.total).toBe(6);
  });

  it('keeps the stated-first order across pages that split the two groups', async () => {
    const { titles, total } = await allPages({ citizenshipStatus: [NON_US], sortBy: 'title' }, 2);
    expect(total).toBe(6);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.slice(0, 3).every((title) => SAYS_OPEN_TO_NON_US.has(title))).toBe(true);
    expect(titles.slice(3).every((title) => DOESNT_SAY.has(title))).toBe(true);
  });

  it('counts only the first page, so later pages do not repeat the split', async () => {
    const second = await searchFellowships({ citizenshipStatus: [NON_US], page: 2, pageSize: 2 });
    expect(second.citizenshipCounts).toBeUndefined();
  });

  it('serves the same set the merged filter served before the split', async () => {
    const result = await searchFellowships({ citizenshipStatus: [NON_US], pageSize: 50 });
    expect(new Set(titlesOf(result))).toEqual(new Set([...SAYS_OPEN_TO_NON_US, ...DOESNT_SAY]));
  });

  it('counts each option as applying it alone returns, under a combined year filter', async () => {
    const combined = { yearOfStudy: [SOPHOMORE], pageSize: 50 };
    const unselected = await searchFellowships(combined);
    expect(unselected.citizenshipCounts?.selected).toBeNull();
    const options = unselected.citizenshipCounts?.options ?? [];
    expect(options.map((option) => option.value)).toEqual([NON_US, US]);
    for (const option of options) {
      const applied = await searchFellowships({ ...combined, citizenshipStatus: [option.value] });
      expect(option.says + option.doesntSay).toBe(applied.total);
      expect(applied.citizenshipCounts?.selected).toEqual({
        says: option.says,
        doesntSay: option.doesntSay,
      });
    }
    expect(options.find((option) => option.value === NON_US)).toMatchObject({
      says: 2,
      doesntSay: 2,
    });
    expect(options.find((option) => option.value === US)).toMatchObject({
      says: 3,
      doesntSay: 2,
    });
  });

  it('orders stated first and counts the split the same way alongside a text query', async () => {
    const searched = { query: 'coastal ecology', citizenshipStatus: [NON_US], pageSize: 50 };
    const result = await searchFellowships(searched);
    const titles = titlesOf(result);
    expect(titles).toHaveLength(6);
    expectStatedFirst(titles);
    expect(result.citizenshipCounts?.selected).toEqual({ says: 3, doesntSay: 3 });
    const option = result.citizenshipCounts?.options.find((entry) => entry.value === NON_US);
    expect(option).toMatchObject({ says: 3, doesntSay: 3 });
    const usOption = result.citizenshipCounts?.options.find((entry) => entry.value === US);
    const usApplied = await searchFellowships({ ...searched, citizenshipStatus: [US] });
    expect((usOption?.says ?? 0) + (usOption?.doesntSay ?? 0)).toBe(usApplied.total);
  });

  it('counts a query and a year filter together', async () => {
    const result = await searchFellowships({
      query: 'coastal ecology',
      yearOfStudy: [SENIOR],
      citizenshipStatus: [NON_US],
      pageSize: 50,
    });
    const titles = titlesOf(result);
    expect(new Set(titles)).toEqual(
      new Set([
        'Fixture Charlie International Grant',
        'Fixture Foxtrot Open Grant',
        'Fixture Delta Empty Grant',
        'Fixture Golf Absent Grant',
      ]),
    );
    expectStatedFirst(titles);
    expect(result.citizenshipCounts?.selected).toEqual({ says: 2, doesntSay: 2 });
  });
});
