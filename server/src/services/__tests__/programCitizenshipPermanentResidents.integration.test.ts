import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import {
  NON_US_CITIZENS_ELIGIBLE as NON_US,
  US_CITIZENS_ELIGIBLE as US,
  US_PERMANENT_RESIDENTS_ELIGIBLE as PERMANENT_RESIDENTS,
} from '../../scrapers/utils/programCitizenship';
import { searchFellowships } from '../fellowshipService';

const program = (title: string, citizenshipStatus: string[] | undefined) => ({
  title,
  summary: `${title} summary about coastal ecology.`,
  description: `${title} description.`,
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...(citizenshipStatus ? { citizenshipStatus } : {}),
});

const OPEN_TO_BOTH = 'Fixture Alpha Open Grant';
const CITIZENS_AND_RESIDENTS = 'Fixture Bravo Resident Grant';
const NON_US_ONLY = 'Fixture Charlie International Grant';
const US_ONLY = 'Fixture Delta Restricted Grant';
const NOT_STATED = 'Fixture Echo Absent Grant';
const EMPTY_STATED = 'Fixture Foxtrot Empty Grant';

const FIXTURES = [
  program(OPEN_TO_BOTH, [US, NON_US]),
  program(CITIZENS_AND_RESIDENTS, [US, PERMANENT_RESIDENTS]),
  program(NON_US_ONLY, [NON_US]),
  program(US_ONLY, [US]),
  program(NOT_STATED, undefined),
  program(EMPTY_STATED, []),
];

const titlesOf = (result: { fellowships: Array<{ title?: string }> }) =>
  result.fellowships.map((fellowship) => String(fellowship.title));

let memoryServer: MongoMemoryServer | undefined;

describe('the permanent-resident citizenship option (#6092)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('program_citizenship_permanent_residents_test'));
    await Fellowship.createIndexes();
    await Fellowship.insertMany(FIXTURES);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('returns a program open to both groups, says first, and leaves out non-U.S.-only and U.S.-only programs', async () => {
    const result = await searchFellowships({
      citizenshipStatus: [PERMANENT_RESIDENTS],
      sortBy: 'title',
      pageSize: 50,
    });
    expect(titlesOf(result)).toEqual([
      OPEN_TO_BOTH,
      CITIZENS_AND_RESIDENTS,
      NOT_STATED,
      EMPTY_STATED,
    ]);
    expect(titlesOf(result)).not.toContain(NON_US_ONLY);
    expect(titlesOf(result)).not.toContain(US_ONLY);
    expect(result.citizenshipCounts?.selected).toEqual({ says: 2, doesntSay: 2 });
  });

  it('counts a program open to both groups under the option, and the not-stated ones as not saying', async () => {
    const unselected = await searchFellowships({ pageSize: 50 });
    const option = unselected.citizenshipCounts?.options.find(
      (entry) => entry.value === PERMANENT_RESIDENTS,
    );
    expect(option).toEqual({ value: PERMANENT_RESIDENTS, says: 2, doesntSay: 2 });
  });

  it('keeps says plus does-not-say equal to what applying each option returns', async () => {
    const unselected = await searchFellowships({ pageSize: 50 });
    const options = unselected.citizenshipCounts?.options ?? [];
    expect(options.map((entry) => entry.value)).toEqual([NON_US, US, PERMANENT_RESIDENTS]);
    for (const option of options) {
      const applied = await searchFellowships({ citizenshipStatus: [option.value], pageSize: 50 });
      expect(option.says + option.doesntSay).toBe(applied.total);
      expect(applied.citizenshipCounts?.selected).toEqual({
        says: option.says,
        doesntSay: option.doesntSay,
      });
    }
  });

  it('applies the same rule beside a text query', async () => {
    const searched = { query: 'coastal ecology', pageSize: 50 };
    const unselected = await searchFellowships(searched);
    const option = unselected.citizenshipCounts?.options.find(
      (entry) => entry.value === PERMANENT_RESIDENTS,
    );
    const applied = await searchFellowships({
      ...searched,
      citizenshipStatus: [PERMANENT_RESIDENTS],
    });
    expect(new Set(titlesOf(applied))).toEqual(
      new Set([OPEN_TO_BOTH, CITIZENS_AND_RESIDENTS, NOT_STATED, EMPTY_STATED]),
    );
    expect(option).toMatchObject({ says: 2, doesntSay: 2 });
    expect(applied.citizenshipCounts?.selected).toEqual({ says: 2, doesntSay: 2 });
  });

  it('leaves the U.S. and non-U.S. options matching only their own stated value', async () => {
    const nonUs = await searchFellowships({ citizenshipStatus: [NON_US], pageSize: 50 });
    expect(new Set(titlesOf(nonUs))).toEqual(
      new Set([OPEN_TO_BOTH, NON_US_ONLY, NOT_STATED, EMPTY_STATED]),
    );
    const us = await searchFellowships({ citizenshipStatus: [US], pageSize: 50 });
    expect(new Set(titlesOf(us))).toEqual(
      new Set([OPEN_TO_BOTH, CITIZENS_AND_RESIDENTS, US_ONLY, NOT_STATED, EMPTY_STATED]),
    );
  });
});
