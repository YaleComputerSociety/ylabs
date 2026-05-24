import { describe, expect, it, vi } from 'vitest';
import {
  OfficialYaleProgramsScraper,
  parseOfficialYaleProgramPage,
} from '../sources/officialYaleProgramsScraper';

describe('OfficialYaleProgramsScraper', () => {
  it('extracts a mentor-matching summer research program', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <main>
          <h1>Wu Tsai Undergraduate Fellowship</h1>
          <p>Undergraduates are matched with Yale faculty mentors for an intensive summer research project.</p>
          <p>Applications are due February 9, 2026.</p>
          <a href="/apply">Apply</a>
        </main>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        hostedByResearchEntityName: 'Wu Tsai Institute',
        hostedByResearchEntityUrl: 'https://wti.yale.edu',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        title: 'Wu Tsai Undergraduate Fellowship',
        programAccessRole: 'MENTOR_MATCHING',
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        applicationLink: 'https://wti.yale.edu/apply',
        deadline: new Date('2026-02-09T23:59:59.999Z'),
      }),
    ]);
  });

  it('treats WTI-style summer research mentorship with stipend support as mentor matching', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <main>
          <h1>Wu Tsai Undergraduate Fellowship</h1>
          <p>Participants carry out summer research and work under the mentorship of Wu Tsai faculty. Fellowship support includes a stipend.</p>
        </main>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        hostedByResearchEntityName: 'Wu Tsai Institute',
        hostedByResearchEntityUrl: 'https://wti.yale.edu',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      programAccessRole: 'MENTOR_MATCHING',
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
    });
  });

  it('extracts a hosted center internship', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <main>
          <h1>Digital Humanities Lab Summer Internship</h1>
          <p>Students join paid internships supporting digital humanities research projects.</p>
          <a href="https://library.yale.edu/digital-humanities-laboratory/apply">Application</a>
        </main>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://library.yale.edu/digital-humanities-laboratory/internships',
        programCategory: 'CENTER_INTERNSHIP',
        hostedByResearchEntityName: 'Digital Humanities Lab',
        hostedByResearchEntityUrl: 'https://library.yale.edu/digital-humanities-laboratory',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      programAccessRole: 'HOSTED_INTERNSHIP',
      programCategory: 'CENTER_INTERNSHIP',
      reviewRequired: true,
    });
  });

  it('does not emit a candidate for a generic non-program page', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <main>
          <h1>Digital Humanities Laboratory</h1>
          <p>The Digital Humanities Laboratory supports teaching, consultation, and collaborations across campus.</p>
          <p>Visit our space to learn about workshops, equipment, and current staff.</p>
        </main>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://library.yale.edu/digital-humanities-laboratory',
        programCategory: 'CENTER_INTERNSHIP',
        hostedByResearchEntityName: 'Digital Humanities Lab',
        hostedByResearchEntityUrl: 'https://library.yale.edu/digital-humanities-laboratory',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toEqual([]);
  });

  it('ignores application links outside primary content', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <body>
          <nav>
            <a href="/apply">Apply</a>
          </nav>
          <main>
            <h1>Digital Humanities Lab Summer Internship</h1>
            <p>The summer internship program places students on digital humanities research projects.</p>
            <a href="/about">About the lab</a>
          </main>
          <footer>
            <a href="https://library.yale.edu/apply">Application</a>
          </footer>
        </body>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://library.yale.edu/digital-humanities-laboratory/internships',
        programCategory: 'CENTER_INTERNSHIP',
        hostedByResearchEntityName: 'Digital Humanities Lab',
        hostedByResearchEntityUrl: 'https://library.yale.edu/digital-humanities-laboratory',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: 'Digital Humanities Lab Summer Internship',
      applicationLink: undefined,
    });
    expect(candidates[0].links).toEqual([
      {
        label: 'About the lab',
        url: 'https://library.yale.edu/about',
      },
    ]);
  });

  it('emits observations through the scraper run without fetching application portals', async () => {
    const fetchPage = vi.fn(
      async () => `
      <main>
        <h1>Research Placement Program</h1>
        <p>Students join a cohort and are placed into research teams.</p>
        <a href="https://example.yale.edu/apply">Apply</a>
      </main>
    `,
    );
    const emitted: any[] = [];
    const scraper = new OfficialYaleProgramsScraper({
      pages: [
        {
          url: 'https://example.yale.edu/program',
          programCategory: 'RECURRING_PROGRAM',
          hostedByResearchEntityName: 'Example Yale Center',
          hostedByResearchEntityUrl: 'https://example.yale.edu',
        },
      ],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: '665000000000000000000001',
      sourceId: '665000000000000000000002',
      sourceName: 'official-yale-programs',
      sourceWeight: 0.9,
      options: { dryRun: false, useCache: false, release: false },
      emit: async (input) => {
        emitted.push(...(Array.isArray(input) ? input : [input]));
      },
      log: () => {},
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'fellowship',
          field: 'programAccessRole',
          value: 'STRUCTURED_ENTRY',
        }),
      ]),
    );
  });
});
