import { describe, expect, it, vi } from 'vitest';
import {
  candidateToObservations,
  parseDeadlineToUtcEndOfDay,
  parseFellowshipCatalogPage,
  YaleCollegeFellowshipsOfficeScraper,
} from '../sources/yaleCollegeFellowshipsOfficeScraper';

const fundingPageUrl = 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through';
const sciencePageUrl =
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale';
const detailPageUrl =
  'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/fixture-research-fellowship';

describe('YaleCollegeFellowshipsOfficeScraper parsing', () => {
  it('suppresses grants and fellowship database navigation links', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <a href="https://yale.communityforce.com/Funds/Search.aspx">
            Student Grants and Fellowships database
          </a>
          <a href="https://yale.communityforce.com/Funds/Search.aspx">
            Yale Student Grant & Fellowship Database
          </a>
          <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123">
            Fixture Family Research Fellowship
          </a>
        </main>
      `,
      sciencePageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      'Fixture Family Research Fellowship',
    ]);
  });

  it('does not surface a recipient roster or nav chrome as a detail-page description (#610)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <header><nav>Skip to main content Academics Advising Calendar Menu</nav></header>
        <main>
          <div class="breadcrumb">Show all breadcrumbs</div>
          <article>
            <h1>Fixture Undergraduate Research Fellowship</h1>
            <p>Program Director: Avery Morgan</p>
            <h2>Fellowship Recipients</h2>
            <p>2025-2026 Fellows</p>
            <ul>
              <li>Casey Parker ‘28 Mentor: Dr. Riley Sawyer</li>
              <li>Jordan Taylor ‘27 Mentor: Dr. Harper Lee</li>
              <li>Dana Robin ’26, returning Mentor: Dr. Sloan Wren</li>
              <li>Rowan Sage ‘25 Mentor: Dr. Skylar Drew</li>
            </ul>
          </article>
        </main>
      `,
      `${detailPageUrl}-roster`,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.description ?? '').toBe('');
    expect(candidate.summary ?? '').toBe('');
    const descriptionObservation = candidateToObservations(candidate).find(
      (observation) => observation.field === 'description',
    );
    expect(descriptionObservation).toBeUndefined();
  });

  it('keeps clean detail-page prose as the description', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <article>
            <h1>Fixture International Research Fellowship</h1>
            <p>The fellowship provides support for original undergraduate research projects abroad in the natural and applied sciences. Currently enrolled sophomores and juniors are eligible to apply. Applicants are expected to have some previous research experience.</p>
          </article>
        </main>
      `,
      `${detailPageUrl}-clean`,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].description).toMatch(
      /provides support for original undergraduate research/,
    );
  });

  it('de-concatenates a two-award "AND"-joined detail-page heading to the primary award (#655)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <article>
            <h1>Fixture Fellowship for International Research in the Sciences AND the Placeholder Summer Fellowship</h1>
            <p>The fellowship provides support for original undergraduate research projects abroad in the natural and applied sciences.</p>
          </article>
        </main>
      `,
      `${detailPageUrl}-two-award`,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe('Fixture Fellowship for International Research in the Sciences');
    expect(candidates[0].sourceKey).toBe(
      'yale-college-fellowships-office:fixture-fellowship-for-international-research-in-the-sciences',
    );
  });

  it('redacts a real contact email out of a detail-page description instead of storing it raw (#773)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <article>
            <h1>Fixture Tax Office Research Grant</h1>
            <p>The grant supports senior essays and independent study. If you are an international student, please contact jordan.taylor@yale.edu in the International Tax Office.</p>
          </article>
        </main>
      `,
      `${detailPageUrl}-contact`,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.description ?? '').not.toContain('jordan.taylor@yale.edu');
    expect(candidate.description ?? '').not.toMatch(/\[email redacted\]/i);
    expect(candidate.description).toMatch(/supports senior essays and independent study/);
  });

  it('does not dump an FAQ + eligibility-form detail page as the description (#669)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <article>
            <h1>Research Internship Program (Computer Science)</h1>
            <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=42">Apply Now</a>
            <h2>FAQs</h2>
            <h3>Can I contact a faculty member before applying?</h3>
            <p>Yes, students are encouraged to reach out to potential mentors ahead of time.</p>
            <h3>Does the internship pay a stipend?</h3>
            <p>The program provides a summer stipend to selected students.</p>
            <h3>How many hours per week are expected?</h3>
            <p>Interns typically commit full time over the summer term.</p>
            <h2>Eligibility Requirements</h2>
            <p>Level: Undergraduates only Class: Sophomores and Juniors GPA: Good standing</p>
          </article>
        </main>
      `,
      'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.title).toBe('Research Internship Program (Computer Science)');
    expect(candidate.description ?? '').toBe('');
    const descriptionObservation = candidateToObservations(candidate).find(
      (observation) => observation.field === 'description',
    );
    expect(descriptionObservation).toBeUndefined();
  });

  it('does not leak inline <style>/<script> chrome into the description (#586)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <article>
            <h1>Tobin Undergraduate Research Assistantships</h1>
            <style>.red {color:red !important;}</style>
            <script>
              $(document).ready(function(){
                $(".node-teaser__opportunity-metadata-label:contains('filled')").addClass("red");
              });
            </script>
            <p>Note: Projects for Fall 2026 will be posted in late August. Applications open in early September and are reviewed on a rolling basis by the sponsoring faculty member.</p>
          </article>
        </main>
      `,
      `${detailPageUrl}-tobin`,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.title).toBe('Tobin Undergraduate Research Assistantships');
    expect(candidate.description ?? '').not.toMatch(/\.red\s*\{/);
    expect(candidate.description ?? '').not.toMatch(/document\)\.ready/);
    expect(candidate.description).toMatch(/Note: Projects for Fall 2026/);
  });

  it('does not leak an inline catalog-row <script>/<style> into the summary (#586)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <h3>Summer Fellowships for Yale College Students</h3>
        <h5>Research*</h5>
        <ul>
          <li>
            <style>.red {color:red !important;}</style>
            <script>var deadlineLabel = "filled"; function markFilled(el) { el.classList.add(deadlineLabel); return el; }</script>
            <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=555">Fixture Family Research Fellowship</a>
            Applications reviewed on a rolling basis by faculty sponsors each term.
          </li>
        </ul>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.summary ?? '').not.toMatch(/\.red\s*\{/);
    expect(candidate.summary ?? '').not.toMatch(/deadlineLabel|markFilled/);
    expect(candidate.summary).toMatch(/Applications reviewed on a rolling basis/);
  });

  it('redacts a real contact email out of a catalog-row summary instead of storing it raw (#773)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <h3>Summer Fellowships for Yale College Students</h3>
        <h5>Research*</h5>
        <ul>
          <li>
            <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=773">Fixture Richter Summer Fellowship</a>
            Send your recommendation letter and funding confirmation to jordan.taylor@yale.edu.
          </li>
        </ul>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.summary ?? '').not.toContain('jordan.taylor@yale.edu');
    expect(candidate.summary ?? '').not.toMatch(/\[email redacted\]/i);
    expect(candidate.summary).toMatch(/Send your recommendation letter/);
  });

  it('merges a catalog label into its exact detail page and keeps the detail title', async () => {
    const programUrl = `${detailPageUrl}-official`;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === fundingPageUrl) {
        return `<main><a href="${programUrl}">Fixture Research Program</a></main>`;
      }
      if (url === programUrl) {
        return `
          <main>
            <h1>Fixture Undergraduate Research Fellowship</h1>
            <p>Students conduct independent research.</p>
          </main>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [fundingPageUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (items) => {
        emitted.push(...(Array.isArray(items) ? items : [items]));
      },
      log: vi.fn(),
    });

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((observation) => observation.field === 'title')?.value).toBe(
      'Fixture Undergraduate Research Fellowship',
    );
    expect(emitted.find((observation) => observation.field === 'sourceUrl')?.value).toBe(
      programUrl,
    );
    expect(emitted.find((observation) => observation.field === 'sourceKey')?.value).toBe(
      'yale-college-fellowships-office:fixture-undergraduate-research-fellowship',
    );
    expect(emitted.find((observation) => observation.field === 'archived')?.value).toBe(false);
  });

  it('does not merge detail pages merely because one links to the other', async () => {
    const firstUrl = `${detailPageUrl}-first`;
    const secondUrl = `${detailPageUrl}-second`;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === firstUrl) {
        return `<main><h1>Fixture First Research Fellowship</h1><a href="${secondUrl}">Related fellowship</a></main>`;
      }
      if (url === secondUrl) {
        return `<main><h1>Fixture Second Research Fellowship</h1><a href="${firstUrl}">Related fellowship</a></main>`;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [firstUrl, secondUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (items) => {
        emitted.push(...(Array.isArray(items) ? items : [items]));
      },
      log: vi.fn(),
    });

    expect(result.entitiesObserved).toBe(2);
    expect(
      emitted
        .filter((observation) => observation.field === 'title')
        .map((observation) => observation.value),
    ).toEqual(['Fixture First Research Fellowship', 'Fixture Second Research Fellowship']);
  });

  it('scopes detail links to program content and prefers the Student Grants host', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <nav><a href="/about-us">About Us</a></nav>
          <div class="node">
            <h1>Fixture Undergraduate Research Fellowship</h1>
            <p>
              Apply through
              <a href="http://studentgrants.yale.edu/">Student Grants & Fellowships database</a>.
            </p>
          </div>
          <footer><a href="/privacy">Privacy</a></footer>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBe('https://studentgrants.yale.edu/');
    expect(candidates[0]?.links).toEqual([
      {
        label: 'Student Grants & Fellowships database',
        url: 'https://studentgrants.yale.edu/',
      },
    ]);
  });

  it('humanizes a link whose anchor text is a bare URL instead of storing the raw URL (#774)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <div class="node">
            <h1>Fixture First-Year Summer Research Fellowship</h1>
            <p>
              Apply through
              <a href="http://studentgrants.yale.edu/">http://studentgrants.yale.edu/</a>.
            </p>
          </div>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.links).toEqual([
      {
        label: 'studentgrants.yale.edu',
        url: 'https://studentgrants.yale.edu/',
      },
    ]);
  });

  it('rejects site-wide nav and footer chrome when a detail page has no content container', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <h1>Tobin Undergraduate Research Assistantships</h1>
        <p>Undergraduates complete an independent, faculty-mentored research project.</p>
        <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=7">Apply Now</a>
        <a href="https://college.yale.edu/campus-life">Campus Life</a>
        <a href="https://funding.yale.edu/faculty-staff">Faculty Directory</a>
        <a href="https://yale.edu/privacy-policy">Privacy Policy</a>
        <a href="https://giving.yale.edu/">Give Back</a>
        <a href="https://www.facebook.com/yale">Facebook</a>
      `,
      'https://economics.yale.edu/undergraduate/tobin-ra',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.links).toEqual([
      {
        label: 'Apply Now',
        url: 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=7',
      },
    ]);
    expect(candidates[0]?.applicationLink).toBe(
      'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=7',
    );
  });

  it('caps the number of program links captured from a link-heavy detail page', () => {
    const relevantLinks = Array.from(
      { length: 20 },
      (_value, index) =>
        `<a href="https://funding.yale.edu/find-funding/fixture-research-fellowship-${index}">Fixture Research Fellowship ${index}</a>`,
    ).join('\n');
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <div class="node">
            <h1>Fixture Undergraduate Research Fellowship</h1>
            <p>Students complete an original research project.</p>
            ${relevantLinks}
          </div>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.links.length).toBe(12);
  });

  it('extracts funding.yale.edu research fellowship rows without fetching CommunityForce', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <h3>Summer Fellowships for Yale College Students</h3>
        <h5>Research*</h5>
        <ul>
          <li><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123">Fixture Family Research Fellowship</a></li>
        </ul>
        <p>Application deadline typically in February/March.</p>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        title: 'Fixture Family Research Fellowship',
        sourceKey: 'yale-college-fellowships-office:fixture-family-research-fellowship',
        sourceUrl: fundingPageUrl,
        applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123',
        purpose: ['Research'],
        termOfAward: ['Summer'],
        deadline: undefined,
        isAcceptingApplications: false,
        reviewRequired: true,
      }),
    ]);
  });

  it('extracts Science and QR rows with exact public deadlines', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <p>
          <a href="/yale-undergraduate-research/fellowship-grants/fixture-research-fellowship">
            YC Fixture Research Fellowships in the Sciences
          </a>
          Deadline: Thursday, February 19, 2026 at 11:00pm ET.
        </p>
      `,
      sciencePageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      title: 'YC Fixture Research Fellowships in the Sciences',
      sourceUrl: sciencePageUrl,
      deadline: new Date('2026-02-19T23:59:59.999Z'),
      isAcceptingApplications: true,
      reviewRequired: false,
    });
  });

  it('extracts individual page deadline headings', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <h1>Yale College Fixture Research Fellowship & Synthetic Science Scholars Program</h1>
        <h2>Deadline for submission</h2>
        <ul><li>Thursday, February 19, 2026 at 11:00pm ET</li></ul>
        <p>Applications must be submitted online through the Student Grants Database.</p>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      title: 'Yale College Fixture Research Fellowship & Synthetic Science Scholars Program',
      deadline: new Date('2026-02-19T23:59:59.999Z'),
      isAcceptingApplications: true,
    });
  });

  it('keeps application-open and deadline dates distinct on compact timelines', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Undergraduate Research Fellowship</h1>
          <p>
            December 5, 2025 Application open
            February 18, 2026, 7:00 pm EST via the Yale fellowship portal Application deadline
            March 2026 Notifications sent
          </p>
        </main>
      `,
      detailPageUrl,
      new Date('2025-11-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      applicationOpenDate: new Date('2025-12-05T00:00:00.000Z'),
      deadline: new Date('2026-02-18T23:59:59.999Z'),
    });
  });

  it('associates labeled dates within their sentence before using direction', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Undergraduate Research Fellowship</h1>
          <p>Program begins May 25, 2026. Application opens: December 5, 2026.</p>
          <p>February 18, 2027 application deadline. Interviews March 5, 2027.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      applicationOpenDate: new Date('2026-12-05T00:00:00.000Z'),
      deadline: new Date('2027-02-18T23:59:59.999Z'),
    });
  });

  it('chooses the closest date after a deadline-for-submission label', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Summer Research Program</h1>
          <p>Program dates: May 25 - July 24, 2026.</p>
          <p>Summer 2026 deadline for submission: Friday, February 6, 2026 at 11:00pm ET.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.deadline).toEqual(new Date('2026-02-06T23:59:59.999Z'));
  });

  it('does not use a preceding program date as the application deadline', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Summer Research Program</h1>
          <p>Program dates May 25 - July 24, 2026. Application deadline Friday, February 6, 2026.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.deadline).toEqual(new Date('2026-02-06T23:59:59.999Z'));
  });

  it('extracts application requirements introduced by a strong inline label', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Summer Research Program</h1>
          <p><strong><a href="/application-information">Application Information</a> must be submitted online.</strong></p>
          <p>Summer 2026 deadline for submission: Friday, February 6, 2026.</p>
          <ul><li>A letter of recommendation from your Principal Investigator is required.</li></ul>
          <ul><li>Include a copy of your transcript.</li></ul>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationInformation).toContain('Application Information');
    expect(candidates[0]?.applicationMaterials).toEqual(['Transcript', 'Recommendation letter']);
  });

  it('respects explicit source language that a program is not research-focused', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Academic Year Program</h1>
          <p>The program does not primarily focus on STEM research.</p>
          <p>Students can attend separate research opportunity workshops.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.researchFocused).toBe(false);
    expect(candidates[0]?.purpose).toEqual([]);
  });

  it('preserves explicit negative research evidence when merging catalog and detail pages', async () => {
    const catalogUrl = fundingPageUrl;
    const programUrl = `${detailPageUrl}-academic-year`;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === catalogUrl) {
        return `<main><a href="${programUrl}">Fixture Academic Year Research Program</a></main>`;
      }
      if (url === programUrl) {
        return `
          <main>
            <h1>Fixture Academic Year Research Program</h1>
            <p>The program does not primarily focus on research.</p>
          </main>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [catalogUrl],
      fetchPage,
    });

    await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (observations) => {
        emitted.push(...(Array.isArray(observations) ? observations : [observations]));
      },
      log: vi.fn(),
    });

    expect(emitted.find((observation) => observation.field === 'researchFocused')?.value).toBe(
      false,
    );
    expect(emitted.find((observation) => observation.field === 'purpose')).toBeUndefined();
  });

  it('prefers detail-page research evidence over conflicting catalog context', async () => {
    const catalogUrl = fundingPageUrl;
    const programUrl = 'https://wti.yale.edu/fellowship';
    const fetchPage = vi.fn(async (url: string) => {
      if (url === catalogUrl) {
        return `
          <main>
            <p>
              <a href="${programUrl}">Fixture Academic Year Research Program</a>
              This listing does not primarily focus on research.
            </p>
          </main>
        `;
      }
      if (url === programUrl) {
        return `
          <main>
            <h1>Fixture Academic Year Research Program</h1>
            <p>Students complete an independent research project with faculty mentorship.</p>
          </main>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [catalogUrl],
      fetchPage,
    });

    await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (observations) => {
        emitted.push(...(Array.isArray(observations) ? observations : [observations]));
      },
      log: vi.fn(),
    });

    expect(emitted.find((observation) => observation.field === 'researchFocused')?.value).toBe(
      true,
    );
    expect(emitted.find((observation) => observation.field === 'purpose')?.value).toContain(
      'Research',
    );
  });

  it('does not promote links on a fellowship detail page into separate programs', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Fixture Undergraduate Research Fellowship</h1>
          <p>Students complete an original research project.</p>
          <a href="/student-grants-database">Yale Student Grant & Fellowship Database</a>
          <a href="/teaching-prizes">Teaching Prizes</a>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('Fixture Undergraduate Research Fellowship');
  });

  it('does not recursively crawl links discovered on fellowship detail pages', async () => {
    const applicationInfoUrl = `${sciencePageUrl}/stars/application-information`;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === detailPageUrl) {
        return `
          <main>
            <h1>Fixture Undergraduate Research Fellowship</h1>
            <p>Students complete an original research project.</p>
            <a href="${applicationInfoUrl}">Application information</a>
          </main>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [detailPageUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (observations) => {
        emitted.push(...(Array.isArray(observations) ? observations : [observations]));
      },
      log: vi.fn(),
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(detailPageUrl, false);
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((observation) => observation.field === 'title')?.value).toBe(
      'Fixture Undergraduate Research Fellowship',
    );
  });

  it('ignores navigation and footer text when classifying a detail page', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <nav><a href="/research-fellowship">Research Fellowship</a></nav>
        <main>
          <h1>Fixture Teaching Prize</h1>
          <p>Recognizes excellence in undergraduate teaching.</p>
        </main>
        <footer>Explore our research fellowship programs.</footer>
      `,
      'https://college.yale.edu/life-at-yale/student-faculty-awards/fixture-teaching-prize',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      title: 'Fixture Teaching Prize',
      researchFocused: false,
      purpose: [],
    });
  });

  it('extracts source-backed research focus, application process, and required materials', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Yale College Fixture Summer Research Fellowship</h1>
          <p>Students conduct an original research project with a Yale faculty mentor.</p>
          <h2>Applications should include the following materials</h2>
          <ul>
            <li>A description of the proposed research project.</li>
            <li>An unofficial transcript and CV/resume.</li>
            <li>A recommendation letter from the proposed faculty mentor.</li>
            <li>A second letter of recommendation.</li>
          </ul>
          <p>Applications must be submitted through the Student Grants Database.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      researchFocused: true,
      applicationMaterials: [
        'Research proposal',
        'CV or resume',
        'Transcript',
        'Recommendation letter',
        'Faculty mentor support',
      ],
    });
    expect(candidates[0]?.applicationInformation).toContain(
      'Applications should include the following materials',
    );
    expect(candidateToObservations(candidates[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'researchFocused', value: true }),
        expect.objectContaining({ field: 'applicationMaterials' }),
        expect.objectContaining({ field: 'applicationInformation' }),
      ]),
    );
  });

  it('does not infer application materials from unrelated page content', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Yale College Fixture Research Fellowship</h1>
          <p>Past fellows have written proposals and shared resumes in workshops.</p>
          <h2>About the fellowship</h2>
          <p>Students conduct independent research with a faculty mentor.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationMaterials).toEqual([]);
    expect(candidates[0]?.applicationInformation).toBeUndefined();
  });

  it('does not duplicate a faculty mentor recommendation', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h1>Yale College Fixture Research Fellowship</h1>
          <h2>Application requirements</h2>
          <p>Submit a recommendation letter from the proposed Yale faculty mentor.</p>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationMaterials).toEqual(['Faculty mentor support']);
  });

  it('extracts structured undergraduate program detail pages', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <h1>STARS Summer Research Program</h1>
        <main>
          <p>Students conduct summer research in a Yale lab and must secure a lab commitment before applying.</p>
          <p>Deadline: February 19, 2026.</p>
        </main>
      `,
      'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/stars/stars-summer-research-program',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      title: 'STARS Summer Research Program',
      deadline: new Date('2026-02-19T23:59:59.999Z'),
    });
    expect(candidateToObservations(candidates[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'programKind', value: 'STRUCTURED_PROGRAM' }),
        expect.objectContaining({ field: 'entryMode', value: 'SECURE_MENTOR_THEN_APPLY' }),
        expect.objectContaining({ field: 'requiresMentorBeforeApply', value: true }),
      ]),
    );
  });

  it('classifies Yale-UC Louvain as a real external summer research entry program', () => {
    const observations = candidateToObservations({
      title: 'Yale-UC Louvain Summer Research Program',
      sourceKey: 'yale-college-fellowships-office:yale-uc-louvain-summer-research-program',
      sourceUrl: 'https://science.yalecollege.yale.edu/yale-uc-louvain-summer-research-program',
      sourceFingerprint: 'fixture',
      applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=louvain',
      links: [],
      purpose: ['Research'],
      termOfAward: ['Summer'],
      summary:
        'Students review available UC Louvain research subjects, contact relevant faculty, and use Tetelman funding only after acceptance.',
      description:
        'The Yale-UC Louvain Summer Research Program places students into summer research subjects with UC Louvain faculty.',
      yearOfStudy: [],
      globalRegions: [],
      citizenshipStatus: [],
      reviewRequired: false,
      isAcceptingApplications: true,
    });

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'programKind', value: 'CENTER_INTERNSHIP' }),
        expect.objectContaining({ field: 'entryMode', value: 'APPLY_TO_PROJECT' }),
        expect.objectContaining({ field: 'requiresMentorBeforeApply', value: false }),
        expect.objectContaining({
          field: 'studentFacingCategory',
          value: 'External summer research program',
        }),
      ]),
    );
  });

  it('canonicalizes moved Yale College financial award URLs', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <p>
            <a href="https://yalecollege.yale.edu/finances/financial-awards-prizes/mellon-mays-undergraduate-fellowship-program">
              Mellon Mays Undergraduate Fellowship Program
            </a>
          </p>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.links).toEqual([
      {
        label: 'Mellon Mays Undergraduate Fellowship Program',
        url: 'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
      },
    ]);
  });

  it('ignores nav, admin, generic funding, and download links as fellowship candidates', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <header>
          <nav>
            <a href="/about-fellowships">About Fellowships</a>
            <a href="/faculty-staff/administering-fellowships-student-grants-database">
              Administering Fellowships in the Student Grants Database
            </a>
          </nav>
        </header>
        <main>
          <p>
            <a href="https://drive.google.com/file/d/example/view">
              70 (engineering, computer science /computer engineering) research internships subjects
            </a>
          </p>
          <p>
            <a href="/find-funding/alternative-funding-options">Alternative Funding Options</a>
          </p>
          <p>
            <a href="/find-funding/fixture-regional-research-fellowship">Fixture Regional Research Fellowship</a>
            Deadline: February 10, 2026.
          </p>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      'Fixture Regional Research Fellowship',
    ]);
  });

  it('does not treat informational or administrative detail pages as fellowships', () => {
    const genericTitles = [
      'About Fellowships',
      'Alternative Funding Options',
      'Administering Fellowships in the Student Grants Database',
      'Advising Fellowship Programs',
    ];

    for (const title of genericTitles) {
      const candidates = parseFellowshipCatalogPage(
        `
          <h1>${title}</h1>
          <main>
            <p>Information for students, faculty, staff, and fellowship advisers.</p>
          </main>
        `,
        `${fundingPageUrl}/${title.toLowerCase().replace(/\s+/g, '-')}`,
        new Date('2026-01-01T00:00:00Z'),
      );

      expect(candidates).toEqual([]);
    }
  });

  it('merges title variants that point to the same CommunityForce application', () => {
    const applicationUrl =
      'http://yale.communityforce.com/Funds/FundDetails.aspx?FixtureFundId=abc123';
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <p>
            <a href="${applicationUrl}">
              Jordan OFixture and Riley Example Fellowship for Synthetic Regional Study
            </a>
          </p>
          <p>
            <a href="${applicationUrl.replace('http://', 'https://')}">
              Jordan O'Fixture and Riley Example Fellowship for Synthetic Regional Study
            </a>
          </p>
          <p>
            <a href="${applicationUrl.replace('http://', 'https://')}">
              Jordan OFixture and Riley Example Fellowship for Synthetic Regional Study
            </a>
          </p>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: "Jordan O'Fixture and Riley Example Fellowship for Synthetic Regional Study",
      applicationLink: applicationUrl.replace('http://', 'https://'),
      links: [
        {
          label: 'Application',
          url: applicationUrl.replace('http://', 'https://'),
        },
      ],
    });
  });

  it('keeps distinct programs separate on a parameterized generic portal', async () => {
    const genericPortal = 'https://yale.communityforce.com/Funds/Search.aspx?cycle=2026';
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <a href="${genericPortal}">Fixture First Research Fellowship</a>
          <a href="${genericPortal}">Fixture Second Research Fellowship</a>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      'Fixture First Research Fellowship',
      'Fixture Second Research Fellowship',
    ]);
  });

  it('parses Month Day Year deadlines as UTC end-of-day and ignores fuzzy dates', () => {
    expect(parseDeadlineToUtcEndOfDay('Deadline: Monday, January 5, 2026 at 11:00pm ET')).toEqual(
      new Date('2026-01-05T23:59:59.999Z'),
    );
    expect(
      parseDeadlineToUtcEndOfDay('Application deadline typically in February/March.'),
    ).toBeUndefined();
    expect(parseDeadlineToUtcEndOfDay('Deadline: February 30, 2026')).toBeUndefined();
  });

  it('parses numeric MM/DD/YY and MM/DD/YYYY deadlines', () => {
    expect(parseDeadlineToUtcEndOfDay('Application Deadline 09/11/26')).toEqual(
      new Date('2026-09-11T23:59:59.999Z'),
    );
    expect(parseDeadlineToUtcEndOfDay('Deadline 3/4/2026')).toEqual(
      new Date('2026-03-04T23:59:59.999Z'),
    );
    expect(parseDeadlineToUtcEndOfDay('Applications due 13/40/26')).toBeUndefined();
  });

  it('captures a numeric deadline near a deadline label and marks it accepting when in the future', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <p>
            <a href="https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program">Research Internship Program</a>
            Application Deadline 09/11/26
          </p>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-08-22T00:00:00Z'),
    );

    expect(candidates[0]?.deadline).toEqual(new Date('2026-09-11T23:59:59.999Z'));
    expect(candidates[0]?.isAcceptingApplications).toBe(true);
  });

  it('marks a rolling-application program accepting even without a deadline', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <p>
            <a href="https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program">Research Internship Program</a>
            Applications are reviewed on a rolling basis as we receive them.
          </p>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-08-22T00:00:00Z'),
    );

    expect(candidates[0]?.deadline).toBeUndefined();
    expect(candidates[0]?.isAcceptingApplications).toBe(true);
  });

  it('emits one source-backed observation group per candidate', () => {
    const observations = candidateToObservations({
      sourceKey: 'yale-college-fellowships-office:fixture-family-research-fellowship',
      sourceFingerprint: 'fingerprint',
      title: 'Fixture Family Research Fellowship',
      summary: 'Supports research.',
      description: 'Supports research.',
      sourceUrl: fundingPageUrl,
      applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123',
      links: [
        {
          label: 'Application',
          url: 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123',
        },
      ],
      deadline: undefined,
      applicationOpenDate: undefined,
      contactOffice: 'Fixture Awards Office',
      contactEmail: 'fixture.awards.office@example.test',
      yearOfStudy: [],
      termOfAward: ['Summer'],
      purpose: ['Research'],
      globalRegions: [],
      citizenshipStatus: [],
      isAcceptingApplications: false,
      reviewRequired: true,
    });

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'fellowship',
          entityKey: 'yale-college-fellowships-office:fixture-family-research-fellowship',
          field: 'title',
          value: 'Fixture Family Research Fellowship',
          sourceUrl: fundingPageUrl,
        }),
        expect.objectContaining({
          entityType: 'fellowship',
          field: 'sourceFingerprint',
          value: 'fingerprint',
        }),
      ]),
    );
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'applicationInformation', value: '' }),
        expect.objectContaining({ field: 'applicationMaterials', value: [] }),
        expect.objectContaining({ field: 'researchFocused', value: false }),
      ]),
    );
  });

  it('does not fetch gated CommunityForce links during a scraper run', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url === fundingPageUrl) {
        return `
          <h3>Summer Fellowships for Yale College Students</h3>
          <h5>Research*</h5>
          <ul>
            <li><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123">Fixture Family Research Fellowship</a></li>
          </ul>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [fundingPageUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: false, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: vi.fn(),
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(fundingPageUrl, false);
    expect(result.entitiesObserved).toBe(1);
    expect(result.metrics?.fellowshipCatalog).toMatchObject({
      discovered: 1,
      emitted: 1,
      deadlineMissing: 1,
      reviewRequired: 1,
    });
    expect(emitted.some((obs) => obs.entityType === 'fellowship')).toBe(true);
  });

  it('does not merge distinct programs that share a generic application portal', async () => {
    const firstUrl =
      'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/fixture-first-fellowship';
    const secondUrl =
      'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/fixture-second-fellowship';
    const genericPortal = 'https://yale.communityforce.com/Funds/Search.aspx';
    const fetchPage = vi.fn(async (url: string) => {
      if (url === firstUrl) {
        return `<main><h1>Fixture First Research Fellowship</h1><a href="${genericPortal}">Apply</a></main>`;
      }
      if (url === secondUrl) {
        return `<main><h1>Fixture Second Research Fellowship</h1><a href="${genericPortal}">Apply</a></main>`;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [firstUrl, secondUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (observations) => {
        emitted.push(...(Array.isArray(observations) ? observations : [observations]));
      },
      log: vi.fn(),
    });

    expect(result.entitiesObserved).toBe(2);
    expect(
      emitted
        .filter((observation) => observation.field === 'title')
        .map((observation) => observation.value),
    ).toEqual(['Fixture First Research Fellowship', 'Fixture Second Research Fellowship']);
  });

  it('rejects unsafe runtime limits before fetching catalog pages', async () => {
    const fetchPage = vi.fn(async () => '<h3>Yale College Fellowships</h3>');
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [fundingPageUrl],
      fetchPage,
    });

    await expect(
      scraper.run({
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-college-fellowships-office',
        sourceWeight: 0.95,
        options: { dryRun: false, useCache: false, release: false, limit: 9007199254740992 },
        emit: async () => {},
        log: vi.fn(),
      }),
    ).rejects.toThrow(/--limit must be a safe non-negative integer/);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('continues when one configured public catalog page is stale', async () => {
    const stalePageUrl = 'https://yalecollege.yale.edu/example/stale-fellowships-directory';
    const fetchPage = vi.fn(async (url: string) => {
      if (url === stalePageUrl) throw new Error('Request failed with status code 404');
      if (url === fundingPageUrl) {
        return `
          <h3>Summer Fellowships for Yale College Students</h3>
          <h5>Research*</h5>
          <ul>
            <li><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=123">Fixture Family Research Fellowship</a></li>
          </ul>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const log = vi.fn();
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [stalePageUrl, fundingPageUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: false, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log,
    });

    expect(fetchPage).toHaveBeenCalledWith(stalePageUrl, false);
    expect(fetchPage).toHaveBeenCalledWith(fundingPageUrl, false);
    expect(log).toHaveBeenCalledWith(
      'Skipping fellowship catalog page after fetch/parse failure',
      expect.objectContaining({ url: stalePageUrl }),
    );
    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('Skipped 1 fellowship page');
    expect(emitted.some((obs) => obs.entityType === 'fellowship')).toBe(true);
  });

  it('keeps the catalog page as source when a public detail link is stale', async () => {
    const staleDetailUrl =
      'https://college.yale.edu/finances/financial-awards-prizes/fixture-undergraduate-fellowship-program';
    const fetchPage = vi.fn(async (url: string) => {
      if (url === fundingPageUrl) {
        return `
          <h3>Yale College Fellowships</h3>
          <p>
            <a href="${staleDetailUrl}">Fixture Undergraduate Fellowship Program</a>
            Supports undergraduate research.
          </p>
        `;
      }
      if (url === staleDetailUrl) throw new Error('Request failed with status code 404');
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [fundingPageUrl],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: false, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: vi.fn(),
    });

    expect(fetchPage).toHaveBeenCalledWith(staleDetailUrl, false);
    expect(result.notes).toContain('Skipped 1 fellowship page');
    expect(emitted.find((obs) => obs.field === 'sourceUrl')?.value).toBe(fundingPageUrl);
    expect(emitted.find((obs) => obs.field === 'sourceUrl')?.sourceUrl).toBe(fundingPageUrl);
    expect(emitted.find((obs) => obs.field === 'links')?.value).toEqual([
      { label: 'Fixture Undergraduate Fellowship Program', url: staleDetailUrl },
    ]);
  });
});

describe('YaleCollegeFellowshipsOfficeScraper bare-root link hygiene (#692)', () => {
  const engineeringDetailUrl =
    'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program';

  it('fails a bare-root application link closed and keeps the specific page link', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <article>
            <h1>Research Internship Program</h1>
            <p>Applications are due March 1, 2027.</p>
            <a href="https://engineering.yale.edu/">Apply</a>
            <a href="${engineeringDetailUrl}">Research Internship Program details</a>
          </article>
        </main>
      `,
      engineeringDetailUrl,
      new Date('2026-08-22T00:00:00.000Z'),
    );

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate.applicationLink).toBeUndefined();
    expect(candidate.links.map((link) => link.url)).not.toContain('https://engineering.yale.edu/');
    expect(candidate.links.map((link) => link.url)).toContain(engineeringDetailUrl);

    const observations = candidateToObservations(candidate);
    expect(observations.find((obs) => obs.field === 'applicationLink')).toBeUndefined();
    expect(observations.find((obs) => obs.field === 'links')?.value).toEqual(candidate.links);
  });
});

describe('YaleCollegeFellowshipsOfficeScraper macmillan opportunity catalog (#675)', () => {
  const macmillanPageUrl = 'https://macmillan.yale.edu/fellowships-and-grants';

  const macmillanCatalogHtml = `
    <main>
      <div class="view__rows">
        <div class="view__row view__row--1">
          <article class="node-teaser node-teaser--opportunity node-teaser--text">
            <header class="node-teaser__header">
              <div class="node-teaser__groups">MacMillan Center</div>
              <div class="node-teaser__heading">
                <a href="https://bit.ly/3rzeOaf"><span>Albert Bildner Travel Prize</span></a>
              </div>
            </header>
            <div class="node-teaser__content">
              <div class="node-teaser__summary">
                <div class="ck-content"><p>Supports travel to Latin America for summer research. Applications due March 15, 2027.</p></div>
              </div>
            </div>
          </article>
        </div>
        <div class="view__row view__row--2">
          <article class="node-teaser node-teaser--opportunity node-teaser--text">
            <header class="node-teaser__header">
              <div class="node-teaser__groups">MacMillan Center</div>
              <div class="node-teaser__heading">
                <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=496">
                  <span>Canadian Studies Summer Grant for Undergraduate Students</span>
                </a>
              </div>
            </header>
            <div class="node-teaser__content">
              <div class="node-teaser__summary">
                <div class="ck-content"><p>Limited summer funding for undergraduate research on Canada.</p></div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </main>
  `;

  it('extracts opportunity-row candidates with clean titles and per-row summaries', () => {
    const candidates = parseFellowshipCatalogPage(
      macmillanCatalogHtml,
      macmillanPageUrl,
      new Date('2026-08-22T00:00:00.000Z'),
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      'Albert Bildner Travel Prize',
      'Canadian Studies Summer Grant for Undergraduate Students',
    ]);

    const prize = candidates.find((candidate) => candidate.title === 'Albert Bildner Travel Prize');
    expect(prize?.summary).toContain('Supports travel to Latin America');
    expect(prize?.deadline?.toISOString()).toBe('2027-03-15T23:59:59.999Z');
    expect(prize?.reviewRequired).toBe(false);
    expect(prize?.applicationLink).toBeUndefined();
    expect(prize?.links).toEqual([
      { label: 'Albert Bildner Travel Prize', url: 'https://bit.ly/3rzeOaf' },
    ]);
    expect(prize?.contactOffice).toBe('MacMillan Center');

    const grant = candidates.find((candidate) =>
      candidate.title.startsWith('Canadian Studies Summer Grant'),
    );
    expect(grant?.applicationLink).toBe(
      'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=496',
    );
    expect(grant?.reviewRequired).toBe(true);
  });

  it('does not apply the opportunity-row adapter on a non-macmillan host', () => {
    const candidates = parseFellowshipCatalogPage(
      macmillanCatalogHtml,
      'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
      new Date('2026-08-22T00:00:00.000Z'),
    );

    expect(candidates).toHaveLength(0);
  });

  it('emits observations for a macmillan opportunity candidate', () => {
    const [candidate] = parseFellowshipCatalogPage(
      macmillanCatalogHtml,
      macmillanPageUrl,
      new Date('2026-08-22T00:00:00.000Z'),
    );
    const observations = candidateToObservations(candidate);
    expect(observations.find((obs) => obs.field === 'title')?.value).toBe(
      'Albert Bildner Travel Prize',
    );
    expect(observations.find((obs) => obs.field === 'sourceName')?.value).toBe(
      'yale-college-fellowships-office',
    );
  });
});

describe('YaleCollegeFellowshipsOfficeScraper bare-deadline summary suppression (#1066)', () => {
  const bareDeadlineCatalogHtml = `
    <main>
      <h2>Fellowships administered through the Office of Science &amp; QR</h2>
      <p>
        <strong><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=42">Fixture Tetelman Fellowship for International Research in the Sciences</a></strong>
        Deadline: Thursday, February 12, 2026 at 11:00pm ET.
      </p>
      <p>
        <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=43">Fixture STARS Summer Research Program</a>
        Deadline: Friday, February 6, 2026 at 11:00pm ET. .
      </p>
      <p>
        <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=44">Fixture STARS II Program</a>
        AY 2025-26 Program Spring Term Deadline: Monday, January 5, 2026 at 11:00pm ET.
      </p>
      <p>
        <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=50">Fixture Global Health Research Fellowship</a>
        Funds mentored fieldwork in low-resource clinical settings for undergraduates.
        Deadline: Wednesday, March 4, 2026 at 11:00pm ET.
      </p>
    </main>
  `;

  it('drops a summary that is only the program name plus its deadline', () => {
    const candidates = parseFellowshipCatalogPage(
      bareDeadlineCatalogHtml,
      sciencePageUrl,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const bareTitles = [
      'Fixture Tetelman Fellowship for International Research in the Sciences',
      'Fixture STARS Summer Research Program',
      'Fixture STARS II Program',
    ];
    for (const title of bareTitles) {
      const candidate = candidates.find((entry) => entry.title === title);
      expect(candidate, `expected candidate for ${title}`).toBeDefined();
      expect(candidate?.summary).toBeUndefined();
    }
  });

  it('keeps a summary that carries descriptive prose alongside the deadline', () => {
    const candidates = parseFellowshipCatalogPage(
      bareDeadlineCatalogHtml,
      sciencePageUrl,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const descriptive = candidates.find(
      (entry) => entry.title === 'Fixture Global Health Research Fellowship',
    );
    expect(descriptive?.summary).toContain('mentored fieldwork in low-resource clinical settings');
  });

  it('does not append an adjacent program block to a prior record (#1066 no cross-program bleed)', () => {
    const candidates = parseFellowshipCatalogPage(
      `
        <main>
          <h2>Fellowships administered through the Office of Science &amp; QR</h2>
          <p><strong><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=61">Fixture Tetelman Fellowship</a></strong> Deadline: Thursday, February 12, 2026 at 11:00pm ET.</p>
          <p>Fixture Tetelman Fellowship funds international research in the sciences for undergraduates.</p>
          <h2>Other Yale-funded Fellowship Opportunities</h2>
          <p><strong><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=62">Fixture HKUST Summer UG Research Program</a></strong></p>
          <p>Is an opportunity for undergraduate students to take up a research placement for 10 weeks at HKUST.</p>
        </main>
      `,
      sciencePageUrl,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    for (const candidate of candidates) {
      expect(candidate.summary || '').not.toContain('HKUST');
      expect(candidate.description || '').not.toContain('HKUST');
    }
  });
});
