import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { searchFellowships } from '../fellowshipService';
import { resetProgramSearchSpellingVocabularyForTests } from '../programSearchSpellingVocabulary';

const program = (title: string, description: string, overrides: Record<string, unknown> = {}) => ({
  title,
  summary: description,
  description,
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

const PROGRAMS = [
  program('Fixture Sophomore Summer Grant', 'Funding for a sophomore research project.'),
  program('Fixture Sophomore Travel Award', 'Travel support for a sophomore studying abroad.'),
  program('Fixture Sophomore Lab Stipend', 'A stipend for a sophomore joining a lab.'),
  program('Fixture Computing Internship', 'A paid internship in scientific computing.'),
  program('Fixture Composition Prize', 'An award for original musical composition.'),
  program('Fixture Community Service Fund', 'Support for community service work.'),
  program('Fixture Freshman Seminar Grant', 'Covers fees for a freshman seminar.'),
  program('Fixture Conference Fees Award', 'Pays conference fees.'),
  program('Fixture Application Fees Waiver', 'Waives application fees.'),
  program('Fixture Hidden Krestology Grant', 'A krestology grant in review.', {
    studentVisibilityTier: 'operator_review',
  }),
  program('Fixture Hidden Krestology Award', 'Another krestology award in review.', {
    studentVisibilityTier: 'operator_review',
  }),
  program('Fixture Hidden Krestology Fund', 'A third krestology fund in review.', {
    studentVisibilityTier: 'operator_review',
  }),
];

let memoryServer: MongoMemoryServer | undefined;

const titles = (result: { fellowships: Array<{ title?: string }> }) =>
  result.fellowships.map((fellowship) => fellowship.title);

describe('program search tolerates misspellings and unfinished words (#4537)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('program_search_typo_prefix_test'));
    await Fellowship.createIndexes();
    await Fellowship.insertMany(PROGRAMS);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(() => resetProgramSearchSpellingVocabularyForTests());

  it('serves a misspelled word the programs the correct spelling serves, and says so', async () => {
    const corrected = await searchFellowships({ query: 'sophmore' });
    const correct = await searchFellowships({ query: 'sophomore' });

    expect(corrected.total).toBe(3);
    expect(titles(corrected).sort()).toEqual(titles(correct).sort());
    expect(corrected.queryCorrection).toEqual({
      originalQuery: 'sophmore',
      correctedQuery: 'sophomore',
    });
    expect(correct.queryCorrection).toBeUndefined();
  });

  it('searches the typed spelling when the student asks for it', async () => {
    const result = await searchFellowships({ query: 'sophmore', correctSpelling: false });

    expect(result.total).toBe(0);
    expect(result.queryCorrection).toBeUndefined();
  });

  it('matches a word the student has not finished typing', async () => {
    const result = await searchFellowships({ query: 'Com' });

    expect(titles(result).sort()).toEqual([
      'Fixture Community Service Fund',
      'Fixture Composition Prize',
      'Fixture Computing Internship',
    ]);
  });

  it('treats a word that starts a corpus word as unfinished rather than misspelled', async () => {
    const result = await searchFellowships({ query: 'fres' });

    expect(result.queryCorrection).toBeUndefined();
    expect(titles(result)).toEqual(['Fixture Freshman Seminar Grant']);
  });

  it('requires every typed word to start a word in the program', async () => {
    const result = await searchFellowships({ query: 'comp intern' });

    expect(titles(result)).toEqual(['Fixture Computing Internship']);
  });

  it('serves whole-word matches ahead of matches only on a word prefix', async () => {
    const result = await searchFellowships({ query: 'community' });

    expect(titles(result)[0]).toBe('Fixture Community Service Fund');
  });

  it('pages through the merged matches without repeating or dropping one', async () => {
    const first = await searchFellowships({ query: 'fixture', page: 1, pageSize: 4 });
    const second = await searchFellowships({ query: 'fixture', page: 2, pageSize: 4 });

    expect(first.total).toBe(9);
    expect(first.totalPages).toBe(3);
    const third = await searchFellowships({ query: 'fixture', page: 3, pageSize: 4 });
    const served = [...titles(first), ...titles(second), ...titles(third)];
    expect(served).toHaveLength(9);
    expect(new Set(served).size).toBe(9);
  });

  it('never corrects a word to one only programs students cannot see carry', async () => {
    const result = await searchFellowships({ query: 'krestolgy' });

    expect(result.queryCorrection).toBeUndefined();
    expect(result.total).toBe(0);
  });

  it('never serves a program a student cannot see through the prefix match', async () => {
    const result = await searchFellowships({ query: 'krest' });

    expect(result.total).toBe(0);
  });
});
