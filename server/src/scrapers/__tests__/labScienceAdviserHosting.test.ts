import { describe, expect, it, vi } from 'vitest';
import {
  UndergradFellowshipRecipientScraper,
  inferYearFromUrl,
  seniorEssayAdviserTableExtractor,
  seniorThesisAdviserParagraphExtractor,
  starsSymposiumBookletExtractor,
  type AdvisorDepartments,
  type AdvisorResolution,
  type ProgramConfig,
  type UserMatch,
} from '../sources/undergradFellowshipRecipientScraper';
import {
  LAB_SCIENCE_ADVISER_DEPARTMENTS,
  adviserPairCountsTowardHosting,
  departmentsAgree,
  isLabScienceDepartment,
} from '../utils/labScienceAdviserRule';
import {
  parseSeniorEssayAdviserTables,
  parseSeniorThesisAdviserParagraphs,
  parseStarsAuthorListBooklet,
  splitAdviserCell,
} from '../utils/undergradAdviserLists';
import type { ObservationInput, ScraperContext } from '../types';

const ESSAY_PAGE = `
<html><body>
  <h2>Class of 2025</h2>
  <table>
    <thead><tr><th>Student</th><th>Senior Project Title</th></tr></thead>
    <tbody><tr><td>Tamsin Orrery</td><td>A Study With No Adviser Column</td></tr></tbody>
  </table>
  <h2>Class of 2024</h2>
  <table>
    <thead><tr><th><strong>STUDENT</strong></th><th>SENIOR PROJECT TITLE</th><th>ADVISOR</th></tr></thead>
    <tbody>
      <tr><td>Quill Ashgrove</td><td>Memory For Edible Things</td><td>Morgan Fennick</td></tr>
      <tr><td>Wren Halloway</td><td>Two Advisers At Once</td><td>Dr. Morgan Fennick and Prof. Jordan Pellow</td></tr>
      <tr><td>Sorrel Imbry</td><td>Three Names</td><td>Casey Brindle, Professor Jordan Pellow, and Avery Tolland</td></tr>
      <tr><td>Linden Marsh</td><td>Placeholder Row</td><td>TBD</td></tr>
      <tr><td>Juniper Vale</td><td>Empty Row</td><td>&nbsp;</td></tr>
      <tr><td>Rue Calloway</td><td>School Qualifier</td><td>Avery Tolland (SOM)</td></tr>
    </tbody>
  </table>
</body></html>`;

const THESIS_PAGE = `
<html><body>
  <h2>Recent Alumni &amp; Senior Theses</h2>
  <div><h3><button>    2026   <svg></svg></button></h3>
    <div>
      <p><span>Bram Oakhurst (BS Geoscience):</span> <a href="https://example.org/a.pdf">Rock Weathering</a> (Riley Stonecrop, adviser)</p>
      <p>Ivy Pellam (BA Earth and Planetary Sciences): <a href="https://example.org/b.pdf">Kelp Forests</a> (Riley Stonecrop and Dana Westerly, Example State University, advisers)</p>
    </div>
  </div>
  <div><h3><button>2025</button></h3>
    <div>
      <p>Hollis Fenwright (BS Geophysics): <a href="https://example.org/c.pdf">Seismic Zones</a> (Prof. Casey Larchmont &amp; Riley Stonecrop, advisers)</p>
      <p>Odell Brightwater (BS Atmosphere): <a href="https://example.org/d.pdf">Urban Heat</a> (Casey Larchmont, adviser; with Pat Seaholm, Example Ocean Institute)</p>
      <p>Mira Thornbury (BS Ecology): <a href="https://example.org/e.pdf">Carbon Lab Work</a> (Sky Ardent, Example Carbon Lab/YSE, adviser)</p>
    </div>
  </div>
</body></html>`;

const AUTHOR_LIST_BOOKLET = [
  'STARS II Research Symposium',
  '1',
  'Hydrogel Chemotaxis of Neural Stem Cells',
  'Quinby Harrow',
  '1',
  ', Lark Mentorson',
  '2',
  ', and Jordan Alderwood',
  '2',
  '1',
  'Science, Technology, and Research Scholar, Yale College, New Haven, CT 06520',
  '2',
  'Department of Biomedical Engineering, Yale University, CT 06520',
  'The subventricular zone is studied here in great detail across many long lines of text.',
  '2',
  'Wound Healing In Diabetic Models',
  'Perrin Ashby',
  '1,2',
  ', Sage Postdocson',
  '1',
  ', and Taylor Birchwood',
  '1',
  '1',
  'Department of Biomedical Engineering, Yale University School of Engineering and Applied',
  '2',
  'Science, Technology, and Research Scholar, Yale College, New Haven, CT 06520',
  'Wound healing presents a significant challenge in medicine across many long lines of text.',
].join('\n');

const TOC_BOOKLET = [
  'Table of Contents',
  'Ellis Junebury, Fenwick lab',
  'Circuit Development In Visual Cortex',
  'Harper Wrenfield, Social Robotics lab',
  'Robots At Home',
  'Rowan Thistleby, Okonkwo lab',
  'Phage Ecology',
  '4',
  'Circuit Development In Visual Cortex',
  'Ellis Junebury',
  '1',
  '; Casey Fenwick, PhD',
  '2',
  '; Morgan Graduateson',
  '2',
  '1',
  'Science, Technology, and Research Scholar, Yale College, New Haven, CT 06520',
  '2',
  'Department of Neuroscience, Yale School of Medicine, New Haven, CT 06520',
  'Interneurons are studied here in great detail across many long lines of body text.',
  '5',
  'Robots At Home',
  'Harper Wrenfield',
  '1,2',
  ', Nicola Postdocova',
  '2',
  ', Brian Robotson',
  '2',
  ', MD',
  '1',
  'Science, Technology, and Research Scholar, Yale College, New Haven, CT 06520',
  '2',
  'Department of Computer Science, Yale University, New Haven, CT, 06520',
  'Socially assistive robotics is studied here in great detail across many lines.',
  '6',
  'Phage Ecology',
  'Rowan Thistleby',
  '1',
  ', Dana Labmanager, Pat Seniorfellow',
  '2',
  '1',
  'Science, Technology, and Research Scholar, Yale College, New Haven, CT 06520',
  '2',
  'Department of Ecology and Evolutionary Biology, Yale University, New Haven CT',
  'Phages are studied here in great detail across many long lines of body text here.',
].join('\n');

const STUDENT_NAMES = [
  'Quill Ashgrove',
  'Wren Halloway',
  'Sorrel Imbry',
  'Bram Oakhurst',
  'Ivy Pellam',
  'Hollis Fenwright',
  'Quinby Harrow',
  'Perrin Ashby',
  'Ellis Junebury',
  'Harper Wrenfield',
];

describe('splitAdviserCell', () => {
  it('splits cells naming two or three advisers and strips titles', () => {
    expect(splitAdviserCell('Dr. Morgan Fennick and Prof. Jordan Pellow').names).toEqual([
      'Morgan Fennick',
      'Jordan Pellow',
    ]);
    expect(
      splitAdviserCell('Casey Brindle, Professor Jordan Pellow, and Avery Tolland').names,
    ).toEqual(['Casey Brindle', 'Jordan Pellow', 'Avery Tolland']);
    expect(splitAdviserCell('Morgan Fennick & Jordan Pellow, advisers').names).toEqual([
      'Morgan Fennick',
      'Jordan Pellow',
    ]);
    expect(splitAdviserCell('Steve Lecturerson (CGSC) Postdoc/Lecturer').names).toEqual([
      'Steve Lecturerson',
    ]);
  });

  it('drops an outside co-adviser named beside a non-Yale institution', () => {
    expect(
      splitAdviserCell('Riley Stonecrop and Dana Westerly, Example State University, advisers'),
    ).toEqual({ names: ['Riley Stonecrop'], outsideAdvisersSkipped: 1 });
    expect(
      splitAdviserCell('Casey Larchmont, adviser; with Pat Seaholm, Example Ocean Institute'),
    ).toEqual({ names: ['Casey Larchmont'], outsideAdvisersSkipped: 1 });
    expect(splitAdviserCell('Sky Ardent, Example Carbon Lab/YSE, adviser').names).toEqual([
      'Sky Ardent',
    ]);
  });

  it('keeps an adviser followed by a credential or a department name', () => {
    expect(splitAdviserCell('Morgan Fennick, PhD')).toEqual({
      names: ['Morgan Fennick'],
      outsideAdvisersSkipped: 0,
    });
    expect(splitAdviserCell('Morgan Fennick, Psychology')).toEqual({
      names: ['Morgan Fennick'],
      outsideAdvisersSkipped: 0,
    });
    expect(splitAdviserCell('Dana Westerly, PhD, Example State University')).toEqual({
      names: [],
      outsideAdvisersSkipped: 1,
    });
  });

  it('reads placeholders as no adviser', () => {
    for (const placeholder of ['', 'TBD', 'N/A', '\u2014', '-', 'None']) {
      expect(splitAdviserCell(placeholder).names).toEqual([]);
    }
  });
});

describe('adviser list page parsers', () => {
  it('reads the adviser column of each class-year table and skips tables without one', () => {
    const { pairs } = parseSeniorEssayAdviserTables(ESSAY_PAGE);
    expect(pairs).toEqual([
      { advisorName: 'Morgan Fennick', year: 2024 },
      { advisorName: 'Morgan Fennick', year: 2024 },
      { advisorName: 'Jordan Pellow', year: 2024 },
      { advisorName: 'Casey Brindle', year: 2024 },
      { advisorName: 'Jordan Pellow', year: 2024 },
      { advisorName: 'Avery Tolland', year: 2024 },
      { advisorName: 'Avery Tolland', year: 2024 },
    ]);
  });

  it('reads the "(Name, adviser)" clause under each year heading', () => {
    const { pairs, outsideAdvisersSkipped } = parseSeniorThesisAdviserParagraphs(THESIS_PAGE);
    expect(pairs).toEqual([
      { advisorName: 'Riley Stonecrop', year: 2026 },
      { advisorName: 'Riley Stonecrop', year: 2026 },
      { advisorName: 'Casey Larchmont', year: 2025 },
      { advisorName: 'Riley Stonecrop', year: 2025 },
      { advisorName: 'Casey Larchmont', year: 2025 },
      { advisorName: 'Sky Ardent', year: 2025 },
    ]);
    expect(outsideAdvisersSkipped).toBe(2);
  });

  it('reads the last non-presenter author of a booklet abstract and their affiliation', () => {
    expect(parseStarsAuthorListBooklet(AUTHOR_LIST_BOOKLET, 2019)).toEqual([
      {
        advisorName: 'Jordan Alderwood',
        year: 2019,
        sourceDepartments: ['Department of Biomedical Engineering, Yale University, CT 06520'],
      },
      {
        advisorName: 'Taylor Birchwood',
        year: 2019,
        sourceDepartments: [
          'Department of Biomedical Engineering, Yale University School of Engineering and Applied',
        ],
      },
    ]);
  });

  it('prefers the lab the table of contents names and refuses a lab surname no author carries', () => {
    expect(parseStarsAuthorListBooklet(TOC_BOOKLET, 2021)).toEqual([
      {
        advisorName: 'Casey Fenwick',
        year: 2021,
        sourceDepartments: [
          'Department of Neuroscience, Yale School of Medicine, New Haven, CT 06520',
        ],
      },
      {
        advisorName: 'Brian Robotson',
        year: 2021,
        sourceDepartments: [
          'Department of Computer Science, Yale University, New Haven, CT, 06520',
        ],
      },
    ]);
  });

  it('keeps the PI-line reader for booklets that print a PI line', () => {
    const recipients = starsSymposiumBookletExtractor(
      ['Avery Quillfeather', 'Department of Chemistry', 'PI: Jordan Alderwood', 'A Title'].join(
        '\n',
      ),
      { pageUrl: 'manual-pdf://stars-ii.pdf', defaultYear: 2025 },
    );
    expect(recipients.map((r) => [r.studentName, r.advisorName])).toEqual([
      ['Avery Quillfeather', 'Jordan Alderwood'],
    ]);
    const authorList = starsSymposiumBookletExtractor(AUTHOR_LIST_BOOKLET, {
      pageUrl: 'manual-pdf://stars-ii-2019.pdf',
      defaultYear: 2019,
    });
    expect(authorList.map((r) => [r.studentName, r.advisorName])).toEqual([
      ['', 'Jordan Alderwood'],
      ['', 'Taylor Birchwood'],
    ]);
  });

  it('reads a booklet year out of a percent-encoded URL', () => {
    expect(
      inferYearFromUrl(
        'https://example.org/files/STARSII%20Abstract%20Booklet%20Spring%202021.pdf',
      ),
    ).toBe(2021);
    expect(inferYearFromUrl('https://example.org/files/Booklet_13Apr2019.pdf')).toBe(2019);
  });
});

describe('lab-science adviser rule', () => {
  it('names lab sciences and refuses humanities and language departments', () => {
    for (const department of [
      'Psychology',
      'Department of Psychology',
      'MEDNSC MNBIO Neuroscience Department',
      'Interdepartmental Neuroscience Program',
      'Computer Science',
      'Psychiatry',
    ]) {
      expect(isLabScienceDepartment(department)).toBe(true);
    }
    for (const department of ['Linguistics', 'Philosophy', 'Cognitive Science', 'Economics']) {
      expect(isLabScienceDepartment(department)).toBe(false);
    }
  });

  it('counts an interdisciplinary-program adviser only when their own department is a lab science', () => {
    const rule = 'lab-science-adviser-department' as const;
    expect(adviserPairCountsTowardHosting(rule, ['Cognitive Science', 'Psychology'])).toBe(true);
    expect(adviserPairCountsTowardHosting(rule, ['Cognitive Science', 'Linguistics'])).toBe(false);
    expect(adviserPairCountsTowardHosting(rule, ['Philosophy'])).toBe(false);
    expect(adviserPairCountsTowardHosting(rule, [])).toBe(false);
    expect(adviserPairCountsTowardHosting('lab-science-program', ['Philosophy'])).toBe(true);
    expect(adviserPairCountsTowardHosting(undefined, [])).toBe(true);
  });

  it('lets the primary department decide when the researcher has one', () => {
    const rule = 'lab-science-adviser-department' as const;
    expect(
      adviserPairCountsTowardHosting(rule, ['Linguistics', 'Computer Science'], 'Linguistics'),
    ).toBe(false);
    expect(adviserPairCountsTowardHosting(rule, ['Linguistics', 'Psychology'], 'Psychology')).toBe(
      true,
    );
    expect(adviserPairCountsTowardHosting(rule, ['Linguistics', 'Computer Science'], '')).toBe(
      true,
    );
  });

  it('counts a primary section through the lab-science department it sits under (#6202)', () => {
    const rule = 'lab-science-adviser-department' as const;
    expect(
      adviserPairCountsTowardHosting(rule, ['Linguistics'], 'Synthetic Mood Section', [
        'Psychiatry',
      ]),
    ).toBe(true);
    expect(adviserPairCountsTowardHosting(rule, ['Psychology'], 'Synthetic Mood Section')).toBe(
      false,
    );
    expect(
      adviserPairCountsTowardHosting(rule, ['Psychology'], 'Synthetic Verse Section', [
        'Linguistics',
      ]),
    ).toBe(false);
  });

  it('agrees on a department across spellings and refuses a different one', () => {
    expect(
      departmentsAgree(['Earth and Planetary Sciences'], ['EPS - Earth & Planetary Sciences']),
    ).toBe(true);
    expect(
      departmentsAgree(
        ['High Energy Physics, Department of Physics, Yale University, New Haven, CT 06511'],
        ['Physics'],
      ),
    ).toBe(true);
    expect(
      departmentsAgree(
        ['Departments of Neurology and Immunobiology, Yale School of Medicine, New Haven, CT'],
        ['Immunobiology'],
      ),
    ).toBe(true);
    expect(departmentsAgree(['Earth and Planetary Sciences'], ['Psychology'])).toBe(false);
    expect(
      departmentsAgree(
        ['Department of Pathology, Yale School of Medicine, CT 06520'],
        ['Internal Medicine'],
      ),
    ).toBe(false);
    expect(departmentsAgree([], ['Psychology'])).toBe(false);
  });
});

describe('adviser pair matching', () => {
  const researcher = (id: string, name: string, primaryDepartment?: string): UserMatch => {
    const [fname, ...rest] = name.split(' ');
    return { _id: id, netid: '', fname, lname: rest.join(' '), primaryDepartment };
  };
  const RESEARCHERS: Record<string, { match: UserMatch; departments: AdvisorDepartments }> = {
    'Morgan Fennick': {
      match: researcher('r-fennick', 'Morgan Fennick', 'Psychology'),
      departments: { departments: ['Psychology', 'Cognitive Science'], affiliations: [] },
    },
    'Jordan Pellow': {
      match: researcher('r-pellow', 'Jordan Pellow', 'Linguistics'),
      departments: { departments: ['Linguistics', 'Cognitive Science'], affiliations: [] },
    },
    'Avery Tolland': {
      match: researcher('r-tolland', 'Avery Tolland', 'Marketing'),
      departments: { departments: ['Marketing'], affiliations: [] },
    },
    'Riley Stonecrop': {
      match: researcher('r-stonecrop', 'Riley Stonecrop', 'Earth & Planetary Sciences'),
      departments: { departments: ['Earth & Planetary Sciences'], affiliations: [] },
    },
    'Casey Larchmont': {
      match: researcher('r-larchmont', 'Casey Larchmont', 'Earth and Planetary Sciences'),
      departments: { departments: ['Earth and Planetary Sciences'], affiliations: [] },
    },
  };
  const AMBIGUOUS = new Set(['Casey Brindle']);

  const makeScraper = (configs: ProgramConfig[], pages: Record<string, string>) => {
    const advisorResolution = vi.fn(async (name: string): Promise<AdvisorResolution> => {
      if (AMBIGUOUS.has(name)) return { status: 'ambiguous' };
      const known = RESEARCHERS[name];
      return known ? { status: 'matched', match: known.match } : { status: 'absent' };
    });
    const ownerDepartments = vi.fn(async (owner: UserMatch) => {
      const known = Object.values(RESEARCHERS).find((entry) => entry.match._id === owner._id);
      return known?.departments ?? { departments: [], affiliations: [] };
    });
    const ownerToGroupSlug = vi.fn(async (owner: UserMatch) =>
      owner._id === 'r-larchmont' ? null : `lead-row-${String(owner._id)}`,
    );
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage: async (url) => pages[url] ?? '',
      advisorResolution,
      ownerDepartments,
      ownerToGroupSlug,
    });
    return { scraper, advisorResolution, ownerDepartments };
  };

  const runScraper = async (scraper: UndergradFellowshipRecipientScraper) => {
    const emitted: ObservationInput[] = [];
    const ctx = {
      options: { useCache: false },
      emit: async (observations: ObservationInput | ObservationInput[]) => {
        emitted.push(...(Array.isArray(observations) ? observations : [observations]));
      },
      log: () => undefined,
    } as unknown as ScraperContext;
    return { result: await scraper.run(ctx), emitted };
  };

  const ESSAYS: ProgramConfig = {
    programKey: 'fixture-essays',
    programName: 'Fixture senior essay',
    urls: ['https://example.org/essays'],
    extractor: seniorEssayAdviserTableExtractor,
    adviserDepartments: ['Cognitive Science', ...LAB_SCIENCE_ADVISER_DEPARTMENTS],
    hostingRule: 'lab-science-adviser-department',
  };
  const THESES: ProgramConfig = {
    programKey: 'fixture-theses',
    programName: 'Fixture senior thesis',
    urls: ['https://example.org/theses'],
    extractor: seniorThesisAdviserParagraphExtractor,
    adviserDepartments: ['Earth and Planetary Sciences'],
    hostingRule: 'lab-science-program',
  };
  const PAGES = {
    'https://example.org/essays': ESSAY_PAGE,
    'https://example.org/theses': THESIS_PAGE,
  };

  it('counts every refusal by reason and attaches only lab-science matches', async () => {
    const { scraper } = makeScraper([ESSAYS], PAGES);
    const { result, emitted } = await runScraper(scraper);

    expect(result.notes).toContain(
      'fixture-essays{parsed=7 matched=2 ambiguous=1 no-match=0 department-mismatch=2 not-lab-science=2 no-lead-row=0}',
    );
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((o) => o.field === 'pastUndergradAdvisees')).toMatchObject({
      entityKey: 'lead-row-r-fennick',
      value: [{ year: 2024, programName: 'Fixture senior essay', count: 2 }],
      sourceUrl: 'https://example.org/essays',
    });
  });

  it('admits a member-department adviser and refuses a primary-Linguistics adviser', async () => {
    RESEARCHERS['Quinn Labwright'] = {
      match: researcher('r-labwright', 'Quinn Labwright', 'Psychology'),
      departments: { departments: ['Psychology'], affiliations: [] },
    };
    RESEARCHERS['Rory Syntaxley'] = {
      match: researcher('r-syntaxley', 'Rory Syntaxley', 'Linguistics'),
      departments: { departments: ['Linguistics', 'Computer Science'], affiliations: [] },
    };
    RESEARCHERS['Sam Ethicsworth'] = {
      match: researcher('r-ethicsworth', 'Sam Ethicsworth', 'Philosophy'),
      departments: { departments: ['Philosophy', 'Linguistics'], affiliations: [] },
    };
    const page = `<h2>Class of 2023</h2><table>
      <tr><th>Student</th><th>Title</th><th>Adviser</th></tr>
      <tr><td>Tove Larkin</td><td>One</td><td>Quinn Labwright</td></tr>
      <tr><td>Uma Fernley</td><td>Two</td><td>Rory Syntaxley</td></tr>
      <tr><td>Vik Osgood</td><td>Three</td><td>Sam Ethicsworth</td></tr>
    </table>`;
    const { scraper } = makeScraper([ESSAYS], { 'https://example.org/essays': page });
    const { result, emitted } = await runScraper(scraper);
    for (const name of ['Quinn Labwright', 'Rory Syntaxley', 'Sam Ethicsworth']) {
      delete RESEARCHERS[name];
    }

    expect(result.notes).toContain(
      'fixture-essays{parsed=3 matched=1 ambiguous=0 no-match=0 department-mismatch=1 not-lab-science=1 no-lead-row=0}',
    );
    expect(emitted.map((o) => o.entityKey)).toEqual([
      'lead-row-r-labwright',
      'lead-row-r-labwright',
    ]);
  });

  it('refuses a matched adviser who leads no existing row', async () => {
    const { scraper } = makeScraper([THESES], PAGES);
    const { result, emitted } = await runScraper(scraper);

    expect(result.notes).toContain(
      'fixture-theses{parsed=6 matched=3 ambiguous=0 no-match=1 department-mismatch=0 not-lab-science=0 no-lead-row=2}',
    );
    expect(emitted.filter((o) => o.field === 'pastUndergradAdvisees')).toEqual([
      expect.objectContaining({
        entityKey: 'lead-row-r-stonecrop',
        value: [
          { year: 2026, programName: 'Fixture senior thesis', count: 2 },
          { year: 2025, programName: 'Fixture senior thesis', count: 1 },
        ],
      }),
    ]);
  });

  it('merges every program a row is matched in into one observation', async () => {
    const shared: ProgramConfig = {
      ...THESES,
      programKey: 'fixture-second',
      programName: 'Fixture second list',
    };
    const { scraper } = makeScraper([THESES, shared], PAGES);
    const { emitted } = await runScraper(scraper);
    const past = emitted.filter((o) => o.field === 'pastUndergradAdvisees');
    expect(past).toHaveLength(1);
    expect(past[0].value).toEqual([
      { year: 2026, programName: 'Fixture second list', count: 2 },
      { year: 2026, programName: 'Fixture senior thesis', count: 2 },
      { year: 2025, programName: 'Fixture second list', count: 1 },
      { year: 2025, programName: 'Fixture senior thesis', count: 1 },
    ]);
  });

  it('stores no student name from an adviser list or an author-list booklet', async () => {
    const booklet: ProgramConfig = {
      programKey: 'fixture-booklet',
      programName: 'Fixture booklet',
      urls: ['https://example.org/booklet-2021'],
      extractor: starsSymposiumBookletExtractor,
      hostingRule: 'lab-science-program',
    };
    RESEARCHERS['Casey Fenwick'] = {
      match: researcher('r-fenwick', 'Casey Fenwick', 'Neuroscience'),
      departments: { departments: ['Neuroscience'], affiliations: [] },
    };
    const { scraper } = makeScraper([ESSAYS, THESES, booklet], {
      ...PAGES,
      'https://example.org/booklet-2021': `${TOC_BOOKLET}\n${AUTHOR_LIST_BOOKLET}`,
    });
    const { emitted } = await runScraper(scraper);
    delete RESEARCHERS['Casey Fenwick'];

    expect(emitted.some((o) => o.entityKey === 'lead-row-r-fenwick')).toBe(true);
    expect(emitted.some((o) => o.field === 'fellowshipRecipients')).toBe(false);
    const stored = JSON.stringify(emitted);
    for (const student of STUDENT_NAMES) expect(stored).not.toContain(student);
  });

  it('never resolves a lab surname that no listed author carries', async () => {
    const booklet: ProgramConfig = {
      programKey: 'fixture-booklet',
      programName: 'Fixture booklet',
      urls: ['https://example.org/booklet-2021'],
      extractor: starsSymposiumBookletExtractor,
      hostingRule: 'lab-science-program',
    };
    const advisorResolution = vi.fn(async (name: string) => {
      const known = RESEARCHERS[name];
      return known
        ? ({ status: 'matched', match: known.match } as const)
        : ({ status: 'absent' } as const);
    });
    const scraper = new UndergradFellowshipRecipientScraper([booklet], {
      fetchPage: async () => TOC_BOOKLET,
      advisorResolution,
      ownerDepartments: async () => ({
        departments: ['Ecology & Evolutionary Biology'],
        affiliations: [],
      }),
      ownerToGroupSlug: async (owner) => `lead-row-${String(owner._id)}`,
    });
    const { result } = await runScraper(scraper);

    expect(advisorResolution.mock.calls.map(([name]) => name)).toEqual([
      'Casey Fenwick',
      'Brian Robotson',
    ]);
    expect(result.notes).toContain('fixture-booklet{parsed=2 ');
  });
});
