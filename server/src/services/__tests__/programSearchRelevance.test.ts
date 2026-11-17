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

  it('reaches a program that states the first year when the student says freshman', () => {
    const catalog = [
      program('Starter Grant', 'Supports new research.', { yearOfStudy: ['First-Year Student'] }),
      program('Senior Grant', 'Open to seniors.', { yearOfStudy: ['Senior'] }),
    ];

    expect(titles(rankedPrograms('freshman', catalog))).toEqual(['Starter Grant']);
    expect(titles(rankedPrograms('first-year', catalog))).toEqual(['Starter Grant']);
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

describe('rankProgramSearch year words (#6397)', () => {
  const catalog = [
    program('Starter Research Grant', 'Funds summer research.', {
      yearOfStudy: ['First-Year Student', 'Sophomore'],
    }),
    program('Upper Year Research Grant', 'Funds research by first-year students who wait.', {
      yearOfStudy: ['Junior', 'Senior'],
    }),
    program('Graduate Field Grant', 'Supports first-year doctoral research.', {
      yearOfStudy: ['PhD Pre-Candidacy', 'Master’s Student'],
    }),
    program('Open Research Grant', 'Funds research for any student.'),
    program('Painting Stipend', 'A studio stipend.', { yearOfStudy: ['First-Year Student'] }),
  ];

  it('returns every program that states the year, then those that state no year, like the year filter', () => {
    expect(titles(rankedPrograms('first-year', catalog))).toEqual([
      'Starter Research Grant',
      'Painting Stipend',
      'Open Research Grant',
    ]);
    expect(titles(rankedPrograms('sophomores', catalog))).toEqual([
      'Starter Research Grant',
      'Open Research Grant',
    ]);
  });

  it('never returns a program whose stated years exclude the year, even when its text names it', () => {
    for (const query of ['first-year', 'freshman research', 'first year research']) {
      const returned = titles(rankedPrograms(query, catalog));
      expect(returned).not.toContain('Upper Year Research Grant');
      expect(returned).not.toContain('Graduate Field Grant');
    }
  });

  it('matches the other words, ranking a program that states the year above one that states none', () => {
    expect(titles(rankedPrograms('freshman research', catalog))).toEqual([
      'Starter Research Grant',
      'Open Research Grant',
    ]);
  });

  it('leaves a query with no year word unchanged', () => {
    expect(titles(rankedPrograms('research', catalog)).sort()).toEqual([
      'Graduate Field Grant',
      'Open Research Grant',
      'Starter Research Grant',
      'Upper Year Research Grant',
    ]);
  });

  it('reads a senior essay, thesis or project as a piece of work rather than a year', () => {
    const thesisGrant = program('Thesis Support Grant', 'Funds senior thesis research.', {
      yearOfStudy: ['Junior'],
    });
    expect(titles(rankedPrograms('senior thesis', [...catalog, thesisGrant]))).toEqual([
      'Thesis Support Grant',
    ]);
    expect(titles(rankedPrograms('seniors', catalog))).toEqual([
      'Upper Year Research Grant',
      'Open Research Grant',
    ]);
  });

  it('reads a rising year as the year the student is in now, the way the sources state it', () => {
    const risingCatalog = [
      program('Bridge Summer Grant', 'Open to rising juniors.', { yearOfStudy: ['Sophomore'] }),
      program('Capstone Grant', 'Open to juniors.', { yearOfStudy: ['Junior'] }),
    ];
    expect(titles(rankedPrograms('rising juniors', risingCatalog))).toEqual([
      'Bridge Summer Grant',
    ]);
    expect(titles(rankedPrograms('rising seniors', risingCatalog))).toEqual(['Capstone Grant']);
  });

  it('reads every year in a rising list as rising, the way the sources state it', () => {
    const risingCatalog = [
      program('Bridge Summer Grant', 'Open to rising juniors.', { yearOfStudy: ['Sophomore'] }),
      program('Capstone Grant', 'Open to rising seniors.', { yearOfStudy: ['Junior'] }),
      program('Final Year Grant', 'Open to seniors.', { yearOfStudy: ['Senior'] }),
    ];
    for (const query of ['rising juniors and seniors', 'rising juniors/seniors']) {
      expect(new Set(titles(rankedPrograms(query, risingCatalog)))).toEqual(
        new Set(['Bridge Summer Grant', 'Capstone Grant']),
      );
    }
  });

  it('matches a rising first year as words, since no stated year names an incoming student', () => {
    const incomingGrant = program('Incoming Scholar Grant', 'For rising freshmen.', {
      yearOfStudy: ['Sophomore'],
    });
    expect(titles(rankedPrograms('rising freshmen', [...catalog, incomingGrant]))).toEqual([
      'Incoming Scholar Grant',
    ]);
  });
});

describe('rankProgramSearch pay and thesis wording (#6398)', () => {
  const catalog = [
    program('Summer Lab Fellowship', 'Supports summer lab research.', { awardAmount: '$4,000' }),
    program('Painting Stipend', 'A paid stipend for studio work in the summer.'),
    program('Internship Program', 'A research internship.', {
      compensationSummary: 'Paid internship',
    }),
    program('Travel Grant', 'Research travel.', {
      compensationSummary: 'Fieldwork travel support when awarded',
    }),
    program('Essay Support Grant', 'Funds senior essay research.', {
      programKind: 'SENIOR_THESIS_FUNDING',
    }),
    program('Thesis Support Grant', 'Funds senior thesis research.', { awardAmount: '$500' }),
  ];

  const fundingCatalog = [
    program('Summer Lab Fellowship', 'Supports summer lab research.', { awardAmount: '$4,000' }),
    program('Amountless Travel Fund', 'Research travel.', {
      programKind: 'TRAVEL_RESEARCH_GRANT',
      compensationSummary: 'Fieldwork travel support when awarded',
    }),
    program('Donor Program', 'A mentoring program funded by a generous donor.', {
      programKind: 'STRUCTURED_PROGRAM',
    }),
  ];

  it('answers paid from a stated award amount or a compensation summary that names pay', () => {
    expect(titles(rankedPrograms('paid', catalog))).toEqual([
      'Summer Lab Fellowship',
      'Internship Program',
      'Thesis Support Grant',
    ]);
    expect(titles(rankedPrograms('stipend', catalog)).sort()).toEqual([
      'Internship Program',
      'Summer Lab Fellowship',
      'Thesis Support Grant',
    ]);
  });

  it('still finds a program by its own title when the title carries a pay or funding word', () => {
    const namedGrant = program('Harbor Research Grant', 'Recognizes research.', {
      programKind: 'RESEARCH_AWARD',
    });
    expect(titles(rankedPrograms('harbor grant', [...catalog, namedGrant]))).toEqual([
      'Harbor Research Grant',
    ]);
    expect(titles(rankedPrograms('painting stipend', catalog))).toEqual(['Painting Stipend']);
    expect(titles(rankedPrograms('painting paid', catalog))).toEqual([]);
  });

  it('never lets a title that only mentions a pay or funding word answer a bare intent query', () => {
    const mentionsOnly = [
      program('Grant Writing Workshop', 'Learn to write proposals.', { programKind: 'OTHER' }),
      program('Stipend Policy', 'How stipends are taxed.', { programKind: 'OTHER' }),
      program('Harbor Mentoring Fund', 'Mentoring for new students.', {
        programKind: 'MENTOR_MATCHING',
        programRole: 'STARTS_RESEARCH',
      }),
    ];
    expect(titles(rankedPrograms('grant', mentionsOnly))).toEqual([]);
    expect(titles(rankedPrograms('stipend', mentionsOnly))).toEqual([]);
    expect(titles(rankedPrograms('funded', mentionsOnly))).toEqual([]);
    expect(titles(rankedPrograms('grant writing', mentionsOnly))).toEqual([
      'Grant Writing Workshop',
    ]);
  });

  it('reads no pay from an amount with no figure or a summary that negates pay', () => {
    const unpaid = [
      program('Volunteer Lab Placement', 'Lab placement.', {
        awardAmount: 'Varies',
        compensationSummary: 'Unpaid volunteer placement, no stipend',
      }),
    ];
    expect(titles(rankedPrograms('paid', unpaid))).toEqual([]);
  });

  it('never infers pay from prose or from a summary that only says funding when awarded', () => {
    const returned = titles(rankedPrograms('paid summer', catalog));
    expect(returned).toEqual(['Summer Lab Fellowship']);
    expect(returned).not.toContain('Painting Stipend');
    expect(titles(rankedPrograms('paid', catalog))).not.toContain('Travel Grant');
  });

  it('answers funded and grant from a funding kind or role, so an amountless fund still counts', () => {
    for (const query of ['funded', 'grant', 'funding']) {
      expect(titles(rankedPrograms(query, fundingCatalog)).sort()).toEqual([
        'Amountless Travel Fund',
        'Summer Lab Fellowship',
      ]);
    }
    expect(titles(rankedPrograms('paid', fundingCatalog))).toEqual(['Summer Lab Fellowship']);
  });

  it('reads thesis and essay as the same piece of work', () => {
    const thesis = titles(rankedPrograms('senior thesis', catalog)).sort();
    const essay = titles(rankedPrograms('senior essay', catalog)).sort();
    expect(thesis).toEqual(['Essay Support Grant', 'Thesis Support Grant']);
    expect(essay).toEqual(thesis);
  });
});
