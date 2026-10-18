import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { searchFellowships } from '../fellowshipService';
import { resetProgramSearchSpellingVocabularyForTests } from '../programSearchSpellingVocabulary';
import { setResearchSearchSpellingVocabularyForTests } from '../researchSearchSpellingVocabulary';
import { buildSearchSpellingVocabulary } from '../searchQuerySpellingCorrection';

const program = (title: string, description: string, overrides: Record<string, unknown> = {}) => ({
  title,
  summary: description,
  description,
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

const PROGRAMS = [
  program('Fixture Harbor Economics Grant', 'Funds economics research during the summer.'),
  program('Fixture Ridge Economics Prize', 'An award for an economics thesis.'),
  program('Fixture Psychology Grant', 'Psychology and public policy research.'),
  program('Fixture Summer Studio Stipend', 'A summer studio stipend.'),
  program(
    'Fixture Regional Studies Travel Award',
    'The center funds travel. The center office reviews center applications under blue skies.',
  ),
  program('Fixture Blue Center Award', 'Short-term research travel.'),
  program('Fixture Language Travel Grant', 'Supports learning a language abroad.'),
  program('Fixture Hidden Blue Center Fund', 'In review.', {
    studentVisibilityTier: 'operator_review',
  }),
];

let memoryServer: MongoMemoryServer | undefined;

const titles = (result: { fellowships: Array<{ title?: string }> }) =>
  result.fellowships.map((fellowship) => fellowship.title);

describe('program search requires every typed word and ranks the titled program first', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('program_search_relevance_test'));
    await Fellowship.createIndexes();
    await Fellowship.insertMany(PROGRAMS);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(() => {
    resetProgramSearchSpellingVocabularyForTests();
    setResearchSearchSpellingVocabularyForTests(buildSearchSpellingVocabulary([]));
  });

  afterEach(() => setResearchSearchSpellingVocabularyForTests(null));

  it('serves fewer programs, never more, when the student adds a word', async () => {
    const oneWord = await searchFellowships({ query: 'economics' });
    const twoWords = await searchFellowships({ query: 'economics summer' });

    expect(titles(oneWord).sort()).toEqual([
      'Fixture Harbor Economics Grant',
      'Fixture Ridge Economics Prize',
    ]);
    expect(titles(twoWords)).toEqual(['Fixture Harbor Economics Grant']);
    expect(twoWords.total).toBe(1);
  });

  it('serves the program titled with the query first', async () => {
    const result = await searchFellowships({ query: 'Blue Center' });

    expect(titles(result)[0]).toBe('Fixture Blue Center Award');
  });

  it('serves nothing rather than a program that names one of two typed words', async () => {
    const result = await searchFellowships({ query: 'machine learning' });

    expect(result.total).toBe(0);
  });

  it('keeps the visibility gate on the ranked results', async () => {
    const result = await searchFellowships({ query: 'Blue Center' });

    expect(titles(result)).not.toContain('Fixture Hidden Blue Center Fund');
  });

  it('pages one ranked list without repeating or dropping a program', async () => {
    const first = await searchFellowships({ query: 'fixture', page: 1, pageSize: 3 });
    const second = await searchFellowships({ query: 'fixture', page: 2, pageSize: 3 });
    const third = await searchFellowships({ query: 'fixture', page: 3, pageSize: 3 });
    const served = [...titles(first), ...titles(second), ...titles(third)];

    expect(first.total).toBe(7);
    expect(new Set(served).size).toBe(7);
  });
});
