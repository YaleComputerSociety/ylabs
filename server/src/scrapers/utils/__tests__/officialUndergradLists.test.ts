import { describe, expect, it } from 'vitest';
import { departmentsAgree } from '../labScienceAdviserRule';
import {
  academicYearEndIn,
  aggregateListEntries,
  englishAdvisedByListings,
  germanSeniorEssayListings,
  politicalScienceEssayPrizeListings,
  yibsSuresFellowListings,
  cleanAdviserName,
  csArchiveTermListings,
  csArchiveTermUrls,
  economicsSeniorEssayAdviserListings,
  theaterSeniorProjectIndexListings,
  googleSheetCsvUrl,
  nameBeforeTitle,
  nameFromHeadingAndEmail,
  parseCsv,
  physicsOpenOpportunityListings,
  psychologyResearchSheetListings,
  splitAdviserNames,
  tobinBoardListings,
  wuTsaiFellowListings,
} from '../officialUndergradLists';

const studentFree = (value: unknown) => JSON.stringify(value);

describe('adviser names', () => {
  it('strips honorifics and credentials', () => {
    expect(cleanAdviserName('Prof. Avery Synthetic, PhD.')).toBe('Avery Synthetic');
    expect(cleanAdviserName('Dr. Blair Q. Invented')).toBe('Blair Q. Invented');
  });

  it('splits two advisers and drops single words', () => {
    expect(splitAdviserNames('Avery Synthetic and Blair Invented')).toEqual([
      'Avery Synthetic',
      'Blair Invented',
    ]);
    expect(splitAdviserNames('Avery Synthetic & Blair Invented')).toHaveLength(2);
    expect(splitAdviserNames('Staff')).toEqual([]);
  });

  it('reads the name a card heading prints before the title, from the email', () => {
    expect(
      nameFromHeadingAndEmail(
        'Casey Fictional Sterling Professor of Physics',
        'casey.fictional@yale.edu',
      ),
    ).toBe('Casey Fictional');
    expect(nameFromHeadingAndEmail('Casey Fictional Professor', 'cf123@yale.edu')).toBe('');
  });
});

describe('CS course archives', () => {
  const index = `<ul><li><a href="25-26b/index.html">Spring 2026</a></li>
    <li><a href="18-19a/index.html">Fall 2018</a></li><li><a href="possible/index.html">Ideas</a></li></ul>`;

  it('finds the term pages of an archive index', () => {
    expect(csArchiveTermUrls(index, 'https://zoo.example.edu/classes/cpsc4900/')).toEqual([
      'https://zoo.example.edu/classes/cpsc4900/25-26b/index.html',
      'https://zoo.example.edu/classes/cpsc4900/18-19a/index.html',
    ]);
  });

  it('reads each project adviser, including a middle initial and a second adviser, and no student', () => {
    const term = `<html><head><title>CPSC 4900 Projects: Spring 2026</title></head><body>
      <h2>Projects: Spring 2026</h2><ul>
      <li> Student One, <i>A Synthetic Project</i>, Adviser: Avery Q. Synthetic.
        <a href="Abstracts/one.html">Abstract</a></li>
      <li> Student Two, <i>Another Project with a Partner</i>, Advisers: Blair Invented and Casey Fictional.
        <a href="Abstracts/two.html">Abstract</a></li>
      </ul></body></html>`;
    const listings = csArchiveTermListings(term, 'https://zoo.example.edu/t', 'cs-senior-projects');
    expect(listings.map((listing) => listing.adviserName)).toEqual([
      'Avery Q. Synthetic',
      'Blair Invented',
      'Casey Fictional',
    ]);
    expect(listings.every((listing) => listing.year === 2026)).toBe(true);
    expect(studentFree(listings)).not.toMatch(/Student|Project/);
  });
});

describe('Tobin RA board', () => {
  const AWARDEES = ['Synthetic Awardee One', 'Synthetic Awardee Two'];
  const project = (input: {
    href: string;
    sponsors: Array<{ name: string; slug?: string }>;
    semester: string;
    filled: boolean;
    award?: string;
  }) => `<article class="node-teaser node-teaser--opportunity">
      <div class="node-teaser__heading"><a href="${input.href}"><span>Synthetic project</span></a></div>
      <dl><div><dt>Faculty Sponsor(s)</dt><dd>${input.sponsors
        .map((sponsor) =>
          sponsor.slug ? `<a href="/people/${sponsor.slug}">${sponsor.name}</a>` : sponsor.name,
        )
        .join(', ')}</dd></div></dl>
      <dl>${input.filled ? '<div><dt>Position filled</dt></div>' : ''}
        <div><dt>Semester</dt><dd> ${input.semester} </dd></div>
        ${input.award ? `<div><dt>Award</dt><dd> ${input.award} </dd></div>` : ''}</dl>
    </article>`;
  const board = `<main>${[
    project({
      href: '/undergraduate/tobin-ra/2026/03/one',
      sponsors: [{ name: 'Avery Synthetic', slug: 'avery-synthetic' }],
      semester: '2026 Fall',
      filled: true,
      award: AWARDEES[0],
    }),
    project({
      href: '/undergraduate/tobin-ra/2018/01/two',
      sponsors: [{ name: 'Avery Synthetic', slug: 'avery-synthetic' }],
      semester: '2018 Spring',
      filled: true,
      award: AWARDEES[1],
    }),
    project({
      href: '/undergraduate/tobin-ra/2025/09/three',
      sponsors: [
        { name: 'Blair Invented', slug: 'blair-invented' },
        { name: 'Casey Fictional', slug: 'casey-fictional' },
      ],
      semester: '2025 Fall',
      filled: true,
      award: AWARDEES.join(', '),
    }),
    project({
      href: '/undergraduate/tobin-ra/2026/03/open',
      sponsors: [{ name: 'Drew Madeup', slug: 'drew-madeup' }],
      semester: '2026 Fall',
      filled: false,
    }),
    project({
      href: '/undergraduate/tobin-ra/2026/03/unlinked',
      sponsors: [{ name: 'Emery Unlinked' }],
      semester: '2026 Fall',
      filled: true,
      award: AWARDEES[0],
    }),
    project({
      href: '/undergraduate/tobin-ra/undated',
      sponsors: [{ name: 'Finley Undated', slug: 'finley-undated' }],
      semester: 'Summer',
      filled: true,
      award: AWARDEES[1],
    }),
  ].join('')}</main>`;
  const url = 'https://economics.example.edu/undergraduate/tobin-ra';

  it('lists each sponsor of every filled project in every semester, dated or not', () => {
    const { listings, projectBlocks } = tobinBoardListings(board, url);
    expect(projectBlocks).toBe(6);
    expect(
      listings.map((listing) => [listing.adviserName, listing.year, listing.adviserProfileUrl]),
    ).toEqual([
      ['Avery Synthetic', 2026, 'https://economics.example.edu/people/avery-synthetic'],
      ['Avery Synthetic', 2018, 'https://economics.example.edu/people/avery-synthetic'],
      ['Blair Invented', 2025, 'https://economics.example.edu/people/blair-invented'],
      ['Casey Fictional', 2025, 'https://economics.example.edu/people/casey-fictional'],
      ['Emery Unlinked', 2026, undefined],
      ['Finley Undated', undefined, 'https://economics.example.edu/people/finley-undated'],
    ]);
    expect(listings[0]).toEqual({
      source: 'tobin-research-assistantships',
      adviserName: 'Avery Synthetic',
      adviserProfileUrl: 'https://economics.example.edu/people/avery-synthetic',
      year: 2026,
      itemKey: 'https://economics.example.edu/undergraduate/tobin-ra/2026/03/one',
      undergraduateKeys: [expect.stringMatching(/^tobin-awardee:[0-9a-f]{64}$/)],
      sourceUrl: url,
    });
  });

  it('never reads an awardee name into a listing', () => {
    const serialized = studentFree(tobinBoardListings(board, url));
    for (const name of AWARDEES) expect(serialized).not.toContain(name);
  });

  it('counts each student of a co-sponsored project once on a row both sponsors resolve to', () => {
    const { listings } = tobinBoardListings(board, url);
    const coSponsored = listings.filter((listing) => listing.year === 2025);
    expect(aggregateListEntries(coSponsored, () => url)).toEqual([
      expect.objectContaining({
        source: 'tobin-research-assistantships',
        count: 2,
        latestYear: 2025,
      }),
    ]);
  });

  it('counts distinct students, not the projects or semesters that name them', () => {
    const { listings } = tobinBoardListings(board, url);
    expect(aggregateListEntries(listings, () => url)[0].count).toBe(AWARDEES.length);
  });

  it('counts a carried-over project once and keeps its newest semester', () => {
    const carriedOver = `<main>${[
      project({
        href: '/undergraduate/tobin-ra/2025/carried',
        sponsors: [{ name: 'Avery Synthetic', slug: 'avery-synthetic' }],
        semester: '2025 Fall',
        filled: true,
        award: AWARDEES[0],
      }),
      project({
        href: '/undergraduate/tobin-ra/2026/01/carried',
        sponsors: [{ name: 'Avery Synthetic', slug: 'avery-synthetic' }],
        semester: '2026 Spring',
        filled: true,
        award: ` ${AWARDEES[0].toUpperCase()} `,
      }),
    ].join('')}</main>`;
    expect(aggregateListEntries(tobinBoardListings(carriedOver, url).listings, () => url)).toEqual([
      expect.objectContaining({ count: 1, latestYear: 2026 }),
    ]);
  });

  it('counts each filled project with no readable award as one student', () => {
    const unawarded = `<main>${['a', 'b']
      .map((slug) =>
        project({
          href: `/undergraduate/tobin-ra/2026/03/${slug}`,
          sponsors: [{ name: 'Avery Synthetic', slug: 'avery-synthetic' }],
          semester: '2026 Fall',
          filled: true,
        }),
      )
      .join('')}</main>`;
    const { listings } = tobinBoardListings(unawarded, url);
    expect(listings.every((listing) => listing.undergraduateKeys === undefined)).toBe(true);
    expect(aggregateListEntries(listings, () => url)[0].count).toBe(2);
  });

  it('draws a fresh salt per read, so an awardee key is never a stable pseudonym', () => {
    const keysOf = () =>
      tobinBoardListings(board, url).listings.flatMap((listing) => listing.undergraduateKeys ?? []);
    const first = keysOf();
    const second = keysOf();
    expect(first.length).toBeGreaterThan(0);
    expect(first.filter((key) => second.includes(key))).toEqual([]);
  });

  it('reads a single sponsor under the singular label and counts a sponsorless filled card', () => {
    const singular = board.replace(/Faculty Sponsor\(s\)/g, 'Faculty Sponsor');
    expect(tobinBoardListings(singular, url).listings).toHaveLength(6);
    const sponsorless = project({
      href: '/undergraduate/tobin-ra/2026/03/none',
      sponsors: [],
      semester: '2026 Fall',
      filled: true,
    });
    expect(tobinBoardListings(`<main>${sponsorless}</main>`, url)).toEqual({
      listings: [],
      projectBlocks: 1,
    });
  });
});

describe('Economics senior essay advisers', () => {
  it('reads each adviser with their email and the department', () => {
    const html = `<table><tbody><tr>
      <td class="faculty-member-info"><a href="/people/blair-invented">Blair Invented</a>
        <span>Professor of Economics</span><a href="mailto:blair.advisor@yale.edu">email</a></td>
      <td><ul><li>Macroeconomics</li></ul></td></tr></tbody></table>`;
    expect(economicsSeniorEssayAdviserListings(html, 'https://economics.example.edu/a')).toEqual([
      expect.objectContaining({
        source: 'economics-senior-essay-advisers',
        adviserName: 'Blair Invented',
        adviserEmail: 'blair.advisor@yale.edu',
        department: 'Economics',
      }),
    ]);
  });
});

describe('Psychology research sheet', () => {
  it('finds the CSV export of the linked sheet', () => {
    expect(
      googleSheetCsvUrl(
        '<a href="https://docs.google.com/spreadsheets/d/AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit">sheet</a>',
      ),
    ).toBe(
      'https://docs.google.com/spreadsheets/d/AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=csv',
    );
  });

  it('parses quoted fields with commas and line breaks', () => {
    expect(parseCsv('a,"b, c","d\n""e"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd\n"e"'],
      ['1', '2', '3'],
    ]);
  });

  it('reads each PI under the department section that holds them', () => {
    const csv = [
      'Contact,Course Credit,PI (Principal Investigator),Lab,Description',
      'Psychology Department,,,,',
      'Grad Contact,Yes,Casey Fictional,Fictional Lab,Studies things',
      'Yale School of Medicine,,,,',
      'Other Contact,No,Dana Madeup & Emery Notreal,Joint Lab,Studies more',
    ].join('\n');
    const listings = psychologyResearchSheetListings(csv, 'https://psychology.example.edu/');
    expect(listings.map((listing) => [listing.adviserName, listing.department])).toEqual([
      ['Casey Fictional', 'Psychology Department'],
      ['Dana Madeup', 'Yale School of Medicine'],
      ['Emery Notreal', 'Yale School of Medicine'],
    ]);
    expect(studentFree(listings)).not.toMatch(/Contact/);
  });
});

describe('Wu Tsai undergraduate fellows', () => {
  it('reads linked and unlinked advisers with the summer of their section', () => {
    const html = `<div class="accordion-item"><div class="accordion-item__heading">Summer 2025</div>
      <div class="accordion-item__content">
        <p class="large">Student One<br>Advisor:<a href="/profile/avery-synthetic">Avery Synthetic</a></p>
        <p>A project title</p>
        <p class="large">Student Two<br>Advisor: Blair Invented</p>
      </div></div>`;
    const listings = wuTsaiFellowListings(html, 'https://wti.example.edu/humans/undergrads');
    expect(listings.map((listing) => [listing.adviserName, listing.year])).toEqual([
      ['Avery Synthetic', 2025],
      ['Blair Invented', 2025],
    ]);
    expect(studentFree(listings)).not.toMatch(/Student|project title/);
  });

  it('never reads a linked student name that comes before the adviser label', () => {
    const html = `<div class="accordion-item"><div class="accordion-item__heading">Summer 2024</div>
      <div class="accordion-item__content">
        <p><a href="/fellows/student-one">Student One</a><br><strong>Advisor:</strong><a href="/profile/avery-synthetic">Avery Synthetic</a></p>
        <p><a href="/fellows/student-two">Student Two</a><br>Advisor: Blair Invented</p>
      </div></div>`;
    const listings = wuTsaiFellowListings(html, 'https://wti.example.edu/humans/undergrads');
    expect(listings.map((listing) => [listing.adviserName, listing.adviserProfileUrl])).toEqual([
      ['Avery Synthetic', 'https://wti.example.edu/profile/avery-synthetic'],
      ['Blair Invented', undefined],
    ]);
    expect(studentFree(listings)).not.toMatch(/Student|\/fellows\//);
  });
});

describe('Physics open research opportunities', () => {
  it('cuts a title printed after the name at the first academic rank', () => {
    expect(nameBeforeTitle('Casey Fictional Associate Professor of Physics')).toBe(
      'Casey Fictional',
    );
    expect(nameBeforeTitle('Dana Madeup')).toBe('Dana Madeup');
  });

  it("keeps a card's email that does not spell the card's name, cutting the name at the title", () => {
    const html = `<h2>Faculty with Open Research Opportunities</h2><ul>
      <li class="custom-card"><h2 class="custom-card__heading"><a href="/people/x">Casey Fictional Associate Professor of Physics</a></h2>
      <div class="custom-card__snippet"><p>Contact</p><p>dana.listed@yale.edu</p></div></li></ul>`;
    const [listing] = physicsOpenOpportunityListings(html, 'https://physics.example.edu/');
    expect(listing.adviserName).toBe('Casey Fictional');
    expect(listing.adviserEmail).toBe('dana.listed@yale.edu');
  });

  it('reads every card from the section heading to the next section, by email', () => {
    const card = (name: string, email: string) =>
      `<li class="custom-card"><h2 class="custom-card__heading"><a href="/people/x">${name}</a></h2>
       <div class="custom-card__snippet"><p>Topics</p><p>${email}</p></div></li>`;
    const html = `<h2>Undergraduate Research Events</h2><ul>${card('Not Listed', 'dana.listed@yale.edu')}</ul>
      <h2 class="custom-card-collection__heading">Faculty with Open Research Opportunities</h2>
      <ul>${card('Casey Fictional Professor of Physics', 'casey.fictional@yale.edu')}</ul>
      <ul>${card('Dana Madeup', 'dana.madeup@yale.edu')}</ul>
      <h2>Contact</h2><ul>${card('After Section', 'casey.after@yale.edu')}</ul>`;
    const listings = physicsOpenOpportunityListings(html, 'https://physics.example.edu/');
    expect(listings.map((listing) => [listing.adviserName, listing.adviserEmail])).toEqual([
      ['Casey Fictional', 'casey.fictional@yale.edu'],
      ['Dana Madeup', 'dana.madeup@yale.edu'],
    ]);
  });
});

describe('humanities essay and summer research lists', () => {
  it('reads the end year of an academic-year heading', () => {
    expect(academicYearEndIn('2024-2025')).toBe(2025);
    expect(academicYearEndIn('Senior Essay Prize Winners 2023-24')).toBe(2024);
    expect(academicYearEndIn('Spring 2026')).toBe(2026);
  });

  it('reads English "advised by" lines under their academic year, and no student or title', () => {
    const html = `<h2>2024-2025</h2>
      <p>Student, One, “A Synthetic Essay,” advised by Avery Synthetic</p>
      <p>Student, Two, “Another Essay,” advised by Blair Invented and Casey Fictional.</p>
      <h2>2023-2024</h2><p>Student, Three, “Older Essay,” advised by Dana Madeup</p>
      <p>A paragraph with no adviser</p>`;
    const listings = englishAdvisedByListings(
      html,
      'https://english.example.edu/',
      'english-senior-essays',
    );
    expect(
      listings.map((listing) => [listing.adviserName, listing.year, listing.department]),
    ).toEqual([
      ['Avery Synthetic', 2025, 'English'],
      ['Blair Invented', 2025, 'English'],
      ['Casey Fictional', 2025, 'English'],
      ['Dana Madeup', 2024, 'English'],
    ]);
    expect(studentFree(listings)).not.toMatch(/Student|Essay/);
  });

  it('reads every "(advisor <name>)" in a Political Science prize line', () => {
    const html = `<h3>Senior Essay Prize Winners 2023-24</h3><ul>
      <li>Student One: A Title (advisor Avery Synthetic): A Named Prize</li>
      <li>Student Two: Title (advisor Blair Invented) Student Three: Title (advisor Casey Fictional): Prize</li></ul>`;
    expect(
      politicalScienceEssayPrizeListings(html, 'https://polisci.example.edu/').map((listing) => [
        listing.adviserName,
        listing.year,
      ]),
    ).toEqual([
      ['Avery Synthetic', 2024],
      ['Blair Invented', 2024],
      ['Casey Fictional', 2024],
    ]);
  });

  it('reads the German adviser line of each essay under its bold year', () => {
    const html = `<p><strong>2024</strong></p>
      <p>“A Synthetic Title”<br />Student One<br />Advisor: Professor Avery Synthetic</p>
      <p><strong>2023</strong></p><p>“Title”<br />Student Two<br />Advisor : Blair Invented</p>`;
    expect(
      germanSeniorEssayListings(html, 'https://german.example.edu/').map((listing) => [
        listing.adviserName,
        listing.year,
      ]),
    ).toEqual([
      ['Avery Synthetic', 2024],
      ['Blair Invented', 2023],
    ]);
  });

  it('reads English advisers one line at a time when a paragraph holds two essays', () => {
    const html = `<h2>2024-2025</h2>
      <p>Student, One, “A Synthetic Essay,” advised by Avery Synthetic<br />Student, Two, “Another Essay,” advised by Blair Invented</p>`;
    const listings = englishAdvisedByListings(
      html,
      'https://english.example.edu/',
      'english-senior-essays',
    );
    expect(listings.map((listing) => listing.adviserName)).toEqual([
      'Avery Synthetic',
      'Blair Invented',
    ]);
    expect(studentFree(listings)).not.toMatch(/Student|Essay/);
  });

  it('reads the YIBS adviser name and the department or school their title states', () => {
    const html = `<div class="field-collection-item-field-person-info">
      <p>Student One, SURES fellow 2024</p>
      <p><strong>Advisor :</strong> Avery Synthetic, <em>Associate Professor of</em><a href="#"> Ecology &amp; Evolutionary Biology</a> <a href="#">Yale School of the Environment</a></p>
      <p><strong>Fellow quote:</strong> “A student sentence, with a comma”</p></div>`;
    const listings = yibsSuresFellowListings(html, 'https://yibs.example.edu/');
    expect(listings).toEqual([
      expect.objectContaining({
        adviserName: 'Avery Synthetic',
        department: 'Ecology & Evolutionary Biology School of the Environment',
        year: 2024,
      }),
    ]);
    const department = listings[0].department ?? '';
    expect(departmentsAgree([department], ['Ecology and Evolutionary Biology'])).toBe(true);
    expect(departmentsAgree([department], ['School of the Environment'])).toBe(true);
    expect(departmentsAgree([department], ['English'])).toBe(false);
    expect(studentFree(listings)).not.toMatch(/student|Fellow/);
  });

  it('leaves a YIBS adviser with no stated title without a department', () => {
    const html = `<div class="field-collection-item-field-person-info">
      <p>SURES fellow 2023</p><p><strong>Advisor:</strong> Blair Invented</p></div>`;
    const [listing] = yibsSuresFellowListings(html, 'https://yibs.example.edu/');
    expect(listing).toEqual(expect.objectContaining({ adviserName: 'Blair Invented', year: 2023 }));
    expect(listing.department).toBeUndefined();
  });
});

describe('Theater, Dance, and Performance Studies senior projects', () => {
  const indexUrl = 'https://tdps.example.edu/archive';
  const card = (lines: string) => `<li class="reference-card"><div class="reference-card__content">
      <h3 class="reference-card__heading"><a class="reference-card__heading-link" href="/01-a-synthetic-play">01: A Synthetic Play</a></h3>
      <div class="reference-card__snippet"><div>${lines}</div></div></div></li>`;

  it('keeps only the adviser credit of a card, never the student, director or title', () => {
    const index = `<h2 class="component-wrapper__heading">2024-25 Curricular Productions</h2><ul>
      ${card('<p>A senior project in acting for Juniper Talloway</p><p>Directed by Ezra Quenby</p><p>Advised by Rowan Synthetic and Harper Invented</p>')}
      ${card('<p>A senior project in directing for Ezra Quenby Advised by Sloane Fictional</p>')}
      ${card('<p>Senior project for Juniper Talloway</p><p>Advisor: Avery Madeup, as a part of THST 344.</p>')}
      </ul>`;

    const listings = theaterSeniorProjectIndexListings(index, indexUrl);

    expect(listings.map((listing) => [listing.adviserName, listing.year, listing.itemKey])).toEqual(
      [
        ['Rowan Synthetic', 2025, 'card:1'],
        ['Harper Invented', 2025, 'card:1'],
        ['Sloane Fictional', 2025, 'card:2'],
        ['Avery Madeup', 2025, 'card:3'],
      ],
    );
    expect(listings.every((listing) => listing.sourceUrl === indexUrl)).toBe(true);
    expect(studentFree(listings)).not.toMatch(/Juniper|Talloway|Ezra|Quenby|Synthetic Play|THST/i);
  });

  it('reads an adviser credit printed straight after the student name with no space', () => {
    const index = `<h2 class="component-wrapper__heading">2024-25 Curricular Productions</h2><ul>
      ${card('<p>A senior project in directing for Ezra Quenby and in acting for Juniper TallowayAdvised by Rowan Synthetic</p>')}</ul>`;

    const listings = theaterSeniorProjectIndexListings(index, indexUrl);

    expect(listings.map((listing) => listing.adviserName)).toEqual(['Rowan Synthetic']);
    expect(studentFree(listings)).not.toMatch(/Juniper|Talloway|Ezra|Quenby/i);
  });

  it('reads no adviser from a production card that credits no senior project', () => {
    const index = `<h2 class="component-wrapper__heading">2023-24 Curricular Productions</h2><ul>
      ${card('<p>Directed by Ezra Quenby</p><p>Advised by Rowan Synthetic</p>')}</ul>`;

    expect(theaterSeniorProjectIndexListings(index, indexUrl)).toEqual([]);
  });

  it('reads nothing from a season whose cards print no adviser, or from cards outside a season', () => {
    const index = `<h2 class="component-wrapper__heading">2025-26 Curricular Productions</h2><ul>
      <li class="reference-card"><h3><a class="reference-card__heading-link" href="/01-new-play">01: New</a></h3></li></ul>
      <h2 class="component-wrapper__heading">Related Links</h2><ul>
      ${card('<p>A senior project in acting for Juniper Talloway</p><p>Advised by Rowan Synthetic</p>')}</ul>`;

    expect(theaterSeniorProjectIndexListings(index, indexUrl)).toEqual([]);
  });
});

describe('aggregateListEntries', () => {
  it('counts advising per source with its latest year, and lists openness without a count', () => {
    const url = (source: string) => `https://example.edu/${source}`;
    expect(
      aggregateListEntries(
        [
          { source: 'cs-senior-projects', adviserName: 'A B', year: 2024, sourceUrl: 'x' },
          { source: 'cs-senior-projects', adviserName: 'A B', year: 2026, sourceUrl: 'x' },
          { source: 'economics-senior-essay-advisers', adviserName: 'A B', sourceUrl: 'y' },
        ],
        url,
      ),
    ).toEqual([
      {
        source: 'cs-senior-projects',
        kind: 'advised',
        count: 2,
        latestYear: 2026,
        sourceUrl: 'https://example.edu/cs-senior-projects',
      },
      {
        source: 'economics-senior-essay-advisers',
        kind: 'open',
        sourceUrl: 'https://example.edu/economics-senior-essay-advisers',
      },
    ]);
  });
});
