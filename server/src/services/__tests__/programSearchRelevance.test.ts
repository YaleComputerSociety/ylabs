import { describe, expect, it } from 'vitest';

import {
  programQueryContentWords,
  programSearchWordStem,
  rankProgramSearch,
} from '../programSearchRelevance';

const program = (title: string, description: string, overrides: Record<string, unknown> = {}) => ({
  title,
  summary: '',
  description,
  ...overrides,
});

const titles = (programs: Array<{ title: string }>) => programs.map((entry) => entry.title);

const rankedPrograms = <T extends Record<string, unknown>>(query: string, catalog: readonly T[]) =>
  rankProgramSearch(query, catalog).programs;

describe('rankProgramSearch ranked programs', () => {
  it('narrows the results when the student adds a word', () => {
    const catalog = [
      program('Harbor Economics Grant', 'Funds economics research during the summer.'),
      program('Ridge Economics Prize', 'An award for an economics thesis.'),
      program('Summer Painting Stipend', 'A summer studio stipend.'),
    ];

    const oneWord = titles(rankedPrograms('economics', catalog));
    const twoWords = titles(rankedPrograms('economics summer', catalog));

    expect(oneWord).toEqual(['Harbor Economics Grant', 'Ridge Economics Prize']);
    expect(twoWords).toEqual(['Harbor Economics Grant']);
    expect(twoWords.every((title) => oneWord.includes(title))).toBe(true);
  });

  it('ranks the program titled with the query above one that repeats the words in its text', () => {
    const catalog = [
      program(
        'Regional Studies Travel Award',
        'Apply through the center. The center funds travel; the center office answers questions about blue skies.',
      ),
      program('Lantern Center Research Award', 'Short-term research travel.'),
      program('Blue Center Research Award', 'Short-term research travel.'),
    ];

    expect(titles(rankedPrograms('Blue Center', catalog))[0]).toBe('Blue Center Research Award');
  });

  it('puts an exact title ahead of a title that only contains the query', () => {
    const catalog = [
      program('Computer Science Summer Research Program', 'Summer research.'),
      program('Computer Science Research', 'Research.'),
    ];

    expect(titles(rankedPrograms('computer science research', catalog))).toEqual([
      'Computer Science Research',
      'Computer Science Summer Research Program',
    ]);
  });

  it('never serves a program that names only one of two typed words', () => {
    const catalog = [
      program('European Travel Grant', 'Supports learning a language abroad.'),
      program('Science Writing Prize', 'For writing about science.'),
    ];

    expect(rankedPrograms('machine learning', catalog)).toEqual([]);
    expect(rankedPrograms('computer science', catalog)).toEqual([]);
  });

  it('keeps a long query from going empty by serving programs missing only one word', () => {
    const catalog = [
      program('History Research Grant', 'Research in history.'),
      program('Laboratory Science Scholarship', 'Research in the natural sciences.'),
    ];

    expect(titles(rankedPrograms('history humanities research', catalog))).toEqual([
      'History Research Grant',
    ]);
  });

  it('ranks programs that carry every word above those missing one', () => {
    const catalog = [
      program('History Research Grant', 'Research in history.'),
      program('Humanities Research Fellowship', 'Research in history and the humanities.'),
    ];

    const ranked = rankProgramSearch('history humanities research', catalog);
    expect(titles(ranked.programs)).toEqual([
      'Humanities Research Fellowship',
      'History Research Grant',
    ]);
    expect(ranked.closeMatchesFrom).toBe(1);
  });

  it('widens a typed topic to its subject only when no program names the topic', () => {
    const catalog = [
      program('Emerging Technology Award', 'Research on artificial intelligence and policy.'),
      program('Policy Grant', 'Public policy research.'),
    ];

    expect(titles(rankedPrograms('machine learning', catalog))).toEqual([
      'Emerging Technology Award',
    ]);
    expect(
      titles(
        rankedPrograms('machine learning', [
          ...catalog,
          program('Machine Learning Internship', 'Build models.'),
        ]),
      ),
    ).toEqual(['Machine Learning Internship']);
  });

  it('does not widen a typed field to its sibling fields', () => {
    const catalog = [
      program('Economics Grant', 'Economics research.'),
      program('Psychology Grant', 'Psychology research.'),
    ];

    expect(titles(rankedPrograms('economics', catalog))).toEqual(['Economics Grant']);
  });

  it('reads a subject name as the whole subject, typed matches first', () => {
    const catalog = [
      program('Neural Network Fellowship', 'Deep learning research.'),
      program('Artificial Intelligence Prize', 'An essay prize.'),
    ];

    expect(titles(rankedPrograms('artificial intelligence', catalog))).toEqual([
      'Artificial Intelligence Prize',
      'Neural Network Fellowship',
    ]);
  });

  it('matches an abbreviation as a whole word, not as the start of another word', () => {
    const catalog = [
      program('Financial Aid Supplement', 'Aid for travel.'),
      program('Artificial Intelligence Award', 'For AI research.'),
    ];

    expect(titles(rankedPrograms('ai', catalog))).toEqual(['Artificial Intelligence Award']);
  });

  it('matches a word the student has not finished typing and a plural or singular form', () => {
    const catalog = [
      program('Economic Development Grant', 'Field studies.'),
      program('Composition Prize', 'Music.'),
    ];

    expect(titles(rankedPrograms('econ', catalog))).toEqual(['Economic Development Grant']);
    expect(titles(rankedPrograms('economics study', catalog))).toEqual([
      'Economic Development Grant',
    ]);
  });

  it('reaches a program the source files under the first year when the student says freshman', () => {
    const catalog = [
      program('Starter Grant', 'Open to first-year students.'),
      program('Senior Grant', 'Open to seniors.'),
    ];

    expect(titles(rankedPrograms('freshman', catalog))).toEqual(['Starter Grant']);
  });

  it('serves nothing for a query of only stop words', () => {
    expect(rankedPrograms('of the', [program('Grant', 'Of the people.')])).toEqual([]);
  });
});

describe('rankProgramSearch', () => {
  const catalog = [
    program('History Research Grant', 'Research in history.'),
    program('Laboratory Science Scholarship', 'Research in the natural sciences.'),
  ];

  it('says when every served program is missing one of three or more words', () => {
    expect(rankProgramSearch('history humanities research', catalog)).toEqual({
      programs: [catalog[0]],
      missingOneWord: true,
      closeMatchesFrom: null,
    });
  });

  it('does not flag results that carry every word', () => {
    expect(rankProgramSearch('history research', catalog).missingOneWord).toBe(false);
  });

  it('does not flag an empty result', () => {
    expect(rankProgramSearch('quantum origami', catalog)).toEqual({
      programs: [],
      missingOneWord: false,
      closeMatchesFrom: null,
    });
  });
});

describe('rankProgramSearch close matches below a thin every-word result', () => {
  const seniorEssayGrant = (college: string) =>
    program(
      `${college} College Senior Research Grant`,
      'Funds a senior research project or senior essay.',
    );
  const everyWord = program('Regional Studies Travel Grant', 'Supports a senior essay in history.');
  const grants = ['Harbor', 'Ridge', 'Meadow', 'Summit', 'Willow', 'Cedar'].map(seniorEssayGrant);

  it('lists programs missing one word below fewer than five that carry every word', () => {
    const ranked = rankProgramSearch('history senior essay', [everyWord, ...grants]);

    expect(ranked.programs[0]).toBe(everyWord);
    expect(ranked.closeMatchesFrom).toBe(1);
    expect(ranked.programs.slice(1)).toEqual(expect.arrayContaining(grants));
    expect(ranked.programs).toHaveLength(1 + grants.length);
    expect(ranked.missingOneWord).toBe(false);
  });

  it('keeps the every-word rule once five programs carry every word', () => {
    const fiveEveryWord = ['North', 'South', 'East', 'West', 'Central'].map((name) =>
      program(`${name} History Senior Essay Grant`, 'Funds a history senior essay.'),
    );
    const ranked = rankProgramSearch('history senior essay', [...fiveEveryWord, ...grants]);

    expect(ranked.programs).toEqual(fiveEveryWord);
    expect(ranked.closeMatchesFrom).toBeNull();
  });

  it('never lists close matches for a query under three words', () => {
    const ranked = rankProgramSearch('history essay', [everyWord, ...grants]);

    expect(ranked.programs).toEqual([everyWord]);
    expect(ranked.closeMatchesFrom).toBeNull();
  });
});

describe('programSearchWordStem', () => {
  it('folds a plural and its singular to one stem without merging unrelated words', () => {
    expect(programSearchWordStem('economics')).toBe(programSearchWordStem('economic'));
    expect(programSearchWordStem('studies')).toBe(programSearchWordStem('study'));
    expect(programSearchWordStem('centers')).toBe(programSearchWordStem('center'));
    expect(programSearchWordStem('sciences')).toBe(programSearchWordStem('science'));
    expect(programSearchWordStem('courses')).toBe(programSearchWordStem('course'));
    expect(programSearchWordStem('required')).toBe(programSearchWordStem('require'));
    expect(programSearchWordStem('employees')).toBe(programSearchWordStem('employee'));
    expect(programSearchWordStem('classes')).toBe(programSearchWordStem('class'));
    expect(programSearchWordStem('churches')).toBe(programSearchWordStem('church'));
    expect(programSearchWordStem('humanities')).not.toBe(programSearchWordStem('human'));
    expect(programSearchWordStem('campus')).toBe('campus');
  });
});

describe('programQueryContentWords', () => {
  it('drops stop words and single letters', () => {
    expect(programQueryContentWords('Research for a student with a plan')).toEqual([
      'research',
      'student',
      'plan',
    ]);
  });
});
