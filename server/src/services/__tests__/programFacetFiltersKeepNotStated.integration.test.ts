import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { searchFellowships } from '../fellowshipService';

const program = (title: string, facets: Record<string, string[]>) => ({
  title,
  summary: `${title} summary.`,
  description: `${title} description.`,
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...facets,
});

let memoryServer: MongoMemoryServer | undefined;

const titles = (result: { fellowships: Array<{ title?: string }> }) =>
  result.fellowships.map((fellowship) => fellowship.title).sort();

describe('every program facet filter keeps programs that state no value (#5235)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('program_facet_filter_test'));
    await Fellowship.createIndexes();
    await Fellowship.insertMany([
      program('Fixture Matching Grant', {
        yearOfStudy: ['Sophomore'],
        termOfAward: ['Summer'],
        purpose: ['Research'],
        globalRegions: ['Asia'],
      }),
      program('Fixture Other Value Grant', {
        yearOfStudy: ['Senior'],
        termOfAward: ['Academic Year'],
        purpose: ['Internship/Work'],
        globalRegions: ['Europe'],
      }),
      program('Fixture Not Stated Grant', {
        yearOfStudy: [],
        termOfAward: [],
        purpose: [],
        globalRegions: [],
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it.each([
    ['yearOfStudy', 'Sophomore'],
    ['termOfAward', 'Summer'],
    ['purpose', 'Research'],
    ['globalRegions', 'Asia'],
  ])('keeps the not-stated program and drops the other value under %s', async (field, value) => {
    expect(titles(await searchFellowships({ [field]: [value] }))).toEqual([
      'Fixture Matching Grant',
      'Fixture Not Stated Grant',
    ]);
  });

  it('applies two facet filters together', async () => {
    expect(
      titles(
        await searchFellowships({ yearOfStudy: ['Sophomore'], termOfAward: ['Academic Year'] }),
      ),
    ).toEqual(['Fixture Not Stated Grant']);
  });
});
