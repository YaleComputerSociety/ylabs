import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { searchFellowships } from '../fellowshipService';

const US = 'U.S. citizens are eligible';
const NON_US = 'Non-U.S. citizens are eligible';

const program = (title: string, citizenshipStatus?: string[]) => ({
  title,
  summary: `${title} summary.`,
  description: `${title} description.`,
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...(citizenshipStatus ? { citizenshipStatus } : {}),
});

let memoryServer: MongoMemoryServer | undefined;

const titles = (result: { fellowships: Array<{ title?: string }> }) =>
  result.fellowships.map((fellowship) => fellowship.title).sort();

describe('a citizenship filter keeps programs that state no citizenship (#5130)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('program_citizenship_filter_test'));
    await Fellowship.createIndexes();
    await Fellowship.insertMany([
      program('Fixture Open Grant', [US, NON_US]),
      program('Fixture Restricted Grant', [US]),
      program('Fixture International Grant', [NON_US]),
      program('Fixture Empty Grant', []),
      program('Fixture Absent Grant'),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('keeps open and not-stated programs and drops a U.S.-only one under the non-U.S. filter', async () => {
    expect(titles(await searchFellowships({ citizenshipStatus: [NON_US] }))).toEqual([
      'Fixture Absent Grant',
      'Fixture Empty Grant',
      'Fixture International Grant',
      'Fixture Open Grant',
    ]);
  });

  it('keeps not-stated programs alongside a text query', async () => {
    expect(titles(await searchFellowships({ query: 'fixture', citizenshipStatus: [US] }))).toEqual([
      'Fixture Absent Grant',
      'Fixture Empty Grant',
      'Fixture Open Grant',
      'Fixture Restricted Grant',
    ]);
  });
});
