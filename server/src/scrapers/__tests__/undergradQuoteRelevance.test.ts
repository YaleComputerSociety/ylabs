import { describe, expect, it } from 'vitest';
import {
  quotePageIsAboutAnotherEntity,
  quoteStatesAnUndergraduateAccessFact,
  rosterSnippetNamesAnUndergraduate,
} from '../undergradQuoteRelevance';

describe('quoteStatesAnUndergraduateAccessFact', () => {
  it('refuses real page text whose only undergraduate mention is not an access fact', () => {
    const notAccess = [
      'She teaches undergraduate and graduate language and culture courses.',
      'Courses Undergraduate: Introduction to Poetry; Daily Themes',
      'Undergraduate Courses Victorian Fiction and Crime',
      'Course Type: Undergraduate',
      'Director of Undergraduate Studies',
      'He served as Director of Undergraduate Studies in History and chair of the department.',
      'Explore our undergraduate program',
      'Our Undergraduate Program',
      'He completed his undergraduate education at a state university with a degree in chemistry.',
      'She contributes to the center by lecturing in the undergraduate course on sleep.',
      'She completed her undergraduate studies at a state university.',
    ];
    for (const quote of notAccess)
      expect(quoteStatesAnUndergraduateAccessFact(quote), quote).toBe(false);
  });

  it('keeps an access fact that shares a sentence with teaching or a degree', () => {
    const access = [
      'Undergraduates join the lab every fall.',
      'He co-teaches an undergraduate course and mentors undergraduate students in the lab.',
      'A current member first joined the lab during his undergraduate studies.',
      'We welcome inquiries from prospective postdocs, graduate students, and undergraduate researchers.',
      'Undergraduate Students and RAs Example Person Undergraduate RA',
      'She teaches and mentors undergraduate researchers in her lab.',
      'The professor teaches courses and welcomes undergraduates to join the lab.',
      'Undergraduate courses are taught by lab members, and undergraduates can join the lab.',
      'We welcome undergraduate majors in biology to join our research.',
      'He teaches undergraduates and welcomes undergraduate students to join the lab.',
    ];
    for (const quote of access)
      expect(quoteStatesAnUndergraduateAccessFact(quote), quote).toBe(true);
  });
});

describe('quotePageIsAboutAnotherEntity', () => {
  const person = { entityType: 'FACULTY_RESEARCH_AREA', websiteUrl: '' };
  const lab = { entityType: 'LAB', websiteUrl: 'https://medicine.yale.edu/lab/example/' };

  it('refuses a department or center program page cited on a row that does not own it', () => {
    const pages = [
      'https://economics.yale.edu/undergraduate/employment-opportunities',
      'https://jewishstudies.yale.edu/undergraduates',
      'https://art.yale.edu/resources/opportunities',
      'https://physics.yale.edu/opportunities',
      'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/',
    ];
    for (const page of pages) {
      expect(quotePageIsAboutAnotherEntity(page, person), page).toBe(true);
      expect(quotePageIsAboutAnotherEntity(page, lab), page).toBe(true);
    }
  });

  it('keeps pages the row owns or that belong to a person or a lab', () => {
    const pages: Array<[string, typeof person]> = [
      ['https://medicine.yale.edu/lab/example/people/', lab],
      ['https://medicine.yale.edu/lab/another/', person],
      ['https://medicine.yale.edu/profile/example-person/', person],
      ['https://examplelab.yale.edu/opportunities', person],
      ['https://example.chem.yale.edu/opportunities', person],
      ['https://www.cs.yale.edu/homes/example/', person],
      ['https://example-lab.org/join', person],
      [
        'https://jackson.yale.edu/example-center/opportunities',
        { entityType: 'CENTER', websiteUrl: 'https://jackson.yale.edu/example-center' },
      ],
    ];
    for (const [page, entity] of pages)
      expect(quotePageIsAboutAnotherEntity(page, entity), page).toBe(false);
  });

  it('judges nothing without an entity or a parseable page', () => {
    expect(quotePageIsAboutAnotherEntity('https://physics.yale.edu/opportunities', null)).toBe(
      false,
    );
    expect(quotePageIsAboutAnotherEntity('not a url', person)).toBe(false);
  });
});

describe('rosterSnippetNamesAnUndergraduate (#3789)', () => {
  it.each([
    'Alice',
    'Jordan Example Undergraduate Research Assistant',
    'Riley Example, Yale College Class of 2028',
    'Sam ExampleSeniorSam joined the group to work on gap extraction',
    'Val Example, Undergraduate Research Fellow',
    'Quinn Example, SURF Fellow',
  ])('counts %s', (snippet) => {
    expect(rosterSnippetNamesAnUndergraduate(snippet)).toBe(true);
  });

  it.each([
    'Sam Example, Senior Software Developer',
    'Pat Example, PhD student',
    'Casey Example, Postdoctoral Associate',
    'Taylor Example completed her undergraduate degree at another university',
    'Kim Example, Research Associate',
    "Lee Example, Master's student",
    'Ash Example, MD student',
    'Ash Example, Medical Student',
    'Rae Example, Rotation student',
    'Val Example, Research Fellow',
    'Pat Example, PhD student, mentors undergraduate researchers',
    '',
  ])('does not count %j', (snippet) => {
    expect(rosterSnippetNamesAnUndergraduate(snippet)).toBe(false);
  });
});

describe('non-access undergraduate shapes (#3831)', () => {
  it.each([
    'Courses Undergraduate: Writing About Literature I, Jane Austen (Freshman seminar, Junior seminar)',
    'Here at Yale, I teach classical Chinese and a Freshman Seminar on Chinese gardens.',
    'Undergraduate faculty',
    'ECON 3380 / GLBL 4102: Emerging Markets. Undergraduate.',
    'A donor, a graduate of Yale College, founded the program to support students.',
    'At the undergraduate level he teaches a basic music appreciation course.',
    'He has also taught for many years in the undergraduate Directed Studies humanities program.',
    'The suites create training opportunities, from undergraduate class projects to research.',
  ])('does not read %j as hosting undergraduates', (quote) => {
    expect(quoteStatesAnUndergraduateAccessFact(quote)).toBe(false);
  });

  it.each([
    'MCDB 4700 students join the lab as undergraduates each spring.',
    'She regularly serves as a senior thesis advisor for undergraduates in the lab.',
    'Enthusiastic undergraduate students keen on gaining research experience are always welcome to our lab.',
    'Our lab hosts STARS 2024 undergraduate fellows.',
    'REU 2025 undergraduate students join us each summer.',
    'ECON 3380: Emerging Markets. Our lab welcomes undergraduate researchers.',
    'Members of the undergraduate class of 2027 join the lab each spring.',
  ])('still reads %j as hosting undergraduates', (quote) => {
    expect(quoteStatesAnUndergraduateAccessFact(quote)).toBe(true);
  });

  it.each(['Jane Doe, YC 2027, Undergraduate Researcher', 'Jane Doe, Undergraduate Class of 2027'])(
    'still counts the roster line %j',
    (snippet) => {
      expect(rosterSnippetNamesAnUndergraduate(snippet)).toBe(true);
    },
  );
});
