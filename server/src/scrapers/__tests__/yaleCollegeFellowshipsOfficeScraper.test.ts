import { describe, expect, it, vi } from 'vitest';
import {
  CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS,
  classificationFromObservedFacts,
} from '../fellowshipClassificationDerivation';
import {
  candidateToObservations,
  createFundShortLinkResolver,
  createRecordWebsiteLinkChecker,
  DEFAULT_PAGE_URLS,
  extractIndexSeedChildDetailUrls,
  MACMILLAN_COUNCIL_GRANT_PAGE_URLS,
  MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT,
  parseFellowshipCatalogPage,
  STEM_FELLOWSHIPS_FUNDING_HUB_URL,
  STUDENT_FACULTY_AWARDS_INDEX_URL,
  parseFundingYaleSitemapProgramUrls,
  inferPurpose,
  readFellowshipCatalogPage,
  rowsMintedByRefusedPages,
  sourceKeyForTitle,
  withoutGoneRecordWebsiteLinks,
  YaleCollegeFellowshipsOfficeScraper,
} from '../sources/yaleCollegeFellowshipsOfficeScraper';
import { parseProgramDate } from '../utils/programDeadline';
import { beginBenchmarkReplay, finishBenchmarkReplay } from '../snapshotBenchmarkMode';
import { POLICY_FETCH_BENCHMARK_NAMESPACE } from '../utils/httpFetch';

const fundingPageUrl = 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through';
const sciencePageUrl =
  'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale';
const detailPageUrl =
  'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/fixture-research-fellowship';

function classifierFieldsIn(observations: Array<{ field: string }>): string[] {
  return observations
    .map((obs) => obs.field)
    .filter((field) => CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS.includes(field));
}

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
    expect(candidates[0].title).toBe(
      'Fixture Fellowship for International Research in the Sciences',
    );
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

  it('keeps two program pages apart when one links the application the other uses', async () => {
    const firstUrl = `${detailPageUrl}-first`;
    const secondUrl = `${detailPageUrl}-second`;
    const sharedApplication =
      'https://yale.communityforce.com/Funds/FundDetails.aspx?FixtureSharedApplication';
    const fetchPage = vi.fn(async (url: string) => {
      if (url === firstUrl) {
        return `<main><h1>Fixture First Research Fellowship</h1><p>The first fellowship supports independent research with a faculty mentor.</p><a href="${sharedApplication}">Joint application</a></main>`;
      }
      if (url === secondUrl) {
        return `<main><h1>Fixture Second Research Fellowship</h1><p>The second fellowship funds summer research for juniors.</p><a href="${sharedApplication}">Apply</a></main>`;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [firstUrl, secondUrl],
      fetchPage,
    });

    await scraper.run({
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

    const descriptionByKey = new Map(
      emitted
        .filter((observation) => observation.field === 'description')
        .map((observation) => [observation.entityKey, String(observation.value)]),
    );
    expect(descriptionByKey.size).toBe(2);
    expect(
      [...descriptionByKey.values()].filter((value) => /first fellowship/.test(value)),
    ).toHaveLength(1);
    expect(
      [...descriptionByKey.values()].filter((value) => /second fellowship/.test(value)),
    ).toHaveLength(1);
    for (const value of descriptionByKey.values()) {
      expect(/first fellowship/.test(value) && /second fellowship/.test(value)).toBe(false);
    }
  });

  it('reads a detail description without the breadcrumb toggle, the page heading, or glued line breaks', () => {
    const [candidate] = parseFellowshipCatalogPage(
      `
        <main>
          <div class="breadcrumbs__wrapper">
            <button class="breadcrumbs__button"><span>Fixture Awards</span></button>
            <nav class="breadcrumbs"><a href="/awards">Fixture Awards</a></nav>
          </div>
          <h1>Fixture Research Fellowship</h1>
          <div class="text">
            <p>The fellowship funds summer research with a faculty mentor.<br><br>Juniors and seniors may apply.</p>
          </div>
        </main>
      `,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidate.title).toBe('Fixture Research Fellowship');
    expect(candidate.description).toBe(
      'The fellowship funds summer research with a faculty mentor. Juniors and seniors may apply.',
    );
  });

  it('reads a labelled-field award description from its description field, not the field list after it', () => {
    const [candidate] = parseFellowshipCatalogPage(
      `
        <h1>Fixture Scholar Fellowship</h1>
        <div class="node node-external-award">
          <div class="field field-name-field-description"><div class="field-label">Description:&nbsp;</div><div class="field-items"><div class="field-item"><p>The fixture institute seeks applications from Ph.D candidates with policy relevant research on conflict management. Scholars receive funding for a 10-month, non-residential fellowship.</p></div></div></div>
          <div class="field field-name-field-adviser"><div class="field-label">Adviser:&nbsp;</div><div class="field-items"><div class="field-item">Any Adviser</div></div></div>
          <div class="field field-name-field-application-deadline"><div class="field-label">Application Open/Deadline:&nbsp;</div><div class="field-items"><div class="field-item">Thursday, September 1, 2022 to Tuesday, October 18, 2022</div></div></div>
          <div class="field field-name-field-citizenship"><div class="field-label">Citizenship:&nbsp;</div><div class="field-items"><div class="field-item">US Citizen</div></div></div>
          <div class="field field-name-field-academic-field"><div class="field-label">Field:&nbsp;</div><div class="field-items"><div class="field-item">Social Science</div></div></div>
          <div class="field field-name-field-application-year"><div class="field-label">Application Year:&nbsp;</div><div class="field-items"><div class="field-item">Graduate Student and Alumni</div></div></div>
        </div>
      `,
      'https://funding.yale.edu/external-award/fixture-scholar-fellowship',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidate.description).toBe(
      'The fixture institute seeks applications from Ph.D candidates with policy relevant research on conflict management. Scholars receive funding for a 10-month, non-residential fellowship.',
    );
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
        `<a href="https://funding.yale.edu/find-funding/fixture-research-fellowship/past-project-${index}">Past project ${index}</a>`,
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
      deadline: new Date('2026-02-20T04:00:00.000Z'),
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
      deadline: new Date('2026-02-20T04:00:00.000Z'),
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
      applicationOpenDate: new Date('2025-12-05T05:00:00.000Z'),
      deadline: new Date('2026-02-19T00:00:00.000Z'),
    });
  });

  it('never takes a deadline from the label after it on a value-then-label timeline (#4172)', () => {
    const timeline = (rows: string[]) =>
      parseFellowshipCatalogPage(
        `<main><h1>Fixture Undergraduate Research Fellowship</h1><div class="text">${rows
          .map((row) => `<p>${row}</p>`)
          .join('\n')}</div></main>`,
        detailPageUrl,
        new Date('2025-11-01T00:00:00Z'),
      )[0];

    const candidate = timeline([
      '<span>December 5, 2025</span><br>Application open',
      '<span>February 18, 2026, 7:00 pm EST via the Yale fellowship portal</span><br>Application deadline',
      '<span>March 2026</span><br>Notifications sent',
      '<span>May 26, 2026</span><br>Program start date',
      '<span>July 24, 2026</span><br>Program end date',
    ]);

    expect(candidate).toMatchObject({
      applicationOpenDate: new Date('2025-12-05T05:00:00.000Z'),
      deadline: new Date('2026-02-19T00:00:00.000Z'),
    });
    expect(
      timeline([
        '<span>December 5, 2025</span><br>Application open',
        '<span>Mid-February</span><br>Application deadline',
        '<span>May 26, 2026</span><br>Program start date',
      ])?.deadline,
    ).toBeUndefined();
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
      applicationOpenDate: new Date('2026-12-05T05:00:00.000Z'),
      deadline: new Date('2027-02-19T04:59:59.999Z'),
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

    expect(candidates[0]?.deadline).toEqual(new Date('2026-02-07T04:00:00.000Z'));
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

    expect(candidates[0]?.deadline).toEqual(new Date('2026-02-07T04:59:59.999Z'));
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
      sitemapUrls: [],
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
      deadline: new Date('2026-02-20T04:59:59.999Z'),
    });
    const observations = candidateToObservations(candidates[0]);
    expect(classifierFieldsIn(observations)).toEqual([]);
    expect(classificationFromObservedFacts(observations)).toMatchObject({
      programKind: 'STRUCTURED_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      requiresMentorBeforeApply: true,
    });
  });

  it('classifies Yale-UC Louvain as a real external summer research entry program', () => {
    const observations = candidateToObservations({
      title: 'Yale-UC Louvain Summer Research Program',
      sourceKey: 'yale-college-fellowships-office:yale-uc-louvain-summer-research-program',
      sourceUrl: 'https://science.yalecollege.yale.edu/yale-uc-louvain-summer-research-program',
      sourceFingerprint: 'fixture',
      deadlineStatement: 'unresolved',
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

    expect(classifierFieldsIn(observations)).toEqual([]);
    expect(classificationFromObservedFacts(observations)).toMatchObject({
      programKind: 'CENTER_INTERNSHIP',
      entryMode: 'APPLY_TO_PROJECT',
      requiresMentorBeforeApply: false,
      studentFacingCategory: 'External summer research program',
    });
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

  it('parses a Month Day Year deadline at its stated New York time and ignores fuzzy dates', () => {
    expect(parseProgramDate('Deadline: Monday, January 5, 2026 at 11:00pm ET', 'deadline')).toEqual(
      new Date('2026-01-06T04:00:00.000Z'),
    );
    expect(
      parseProgramDate('Application deadline typically in February/March.', 'deadline'),
    ).toBeUndefined();
    expect(parseProgramDate('Deadline: February 30, 2026', 'deadline')).toBeUndefined();
  });

  it('parses numeric MM/DD/YY and MM/DD/YYYY deadlines as the end of the New York day', () => {
    expect(parseProgramDate('Application Deadline 09/11/26', 'deadline')).toEqual(
      new Date('2026-09-12T03:59:59.999Z'),
    );
    expect(parseProgramDate('Deadline 3/4/2026', 'deadline')).toEqual(
      new Date('2026-03-05T04:59:59.999Z'),
    );
    expect(parseProgramDate('Applications due 13/40/26', 'deadline')).toBeUndefined();
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

    expect(candidates[0]?.deadline).toEqual(new Date('2026-09-12T03:59:59.999Z'));
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
      deadlineStatement: 'unresolved',
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
      sitemapUrls: [],
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

describe('YaleCollegeFellowshipsOfficeScraper find-funding sitemap crawl (#1536)', () => {
  const sitemapUrl = 'https://funding.yale.edu/sitemap.xml';
  const externalAwardUrl = 'https://funding.yale.edu/external-award/fixture-goldwater-scholarship';
  const findFundingProgramUrl = 'https://funding.yale.edu/find-funding/fixture-light-fellowship';
  const communityForceUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=1536';

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>http://funding.yale.edu/</loc></url>
      <url><loc>http://funding.yale.edu/find-funding</loc></url>
      <url><loc>http://funding.yale.edu/find-funding/search-fellowships</loc></url>
      <url><loc>http://funding.yale.edu/find-funding/external-awards-non-yale</loc></url>
      <url><loc>http://funding.yale.edu/find-funding/yale-fellowships-offered-through</loc></url>
      <url><loc>http://funding.yale.edu/connect/fellowships-staff</loc></url>
      <url><loc>http://funding.yale.edu/external-award/fixture-goldwater-scholarship</loc></url>
      <url><loc>http://funding.yale.edu/find-funding/fixture-light-fellowship</loc></url>
    </urlset>`;

  it('selects only individual program pages, normalizes to https, and drops index/hub roots', () => {
    expect(parseFundingYaleSitemapProgramUrls(sitemapXml)).toEqual([
      externalAwardUrl,
      findFundingProgramUrl,
    ]);
  });

  it('never emits a find-funding index or hub root as a candidate source', () => {
    for (const indexUrl of [
      'https://funding.yale.edu/find-funding',
      'https://funding.yale.edu/find-funding/external-awards-non-yale',
      'https://funding.yale.edu/find-funding/search-fellowships',
    ]) {
      const candidates = parseFellowshipCatalogPage(
        `
          <main>
            <div class="node">
              <h1 id="page-title">External Awards (non-Yale Fellowships)</h1>
              <p>Browse the full database of external fellowships and scholarships.</p>
            </div>
          </main>
        `,
        indexUrl,
        new Date('2026-01-01T00:00:00Z'),
      );
      expect(candidates, indexUrl).toEqual([]);
    }
  });

  it('crawls sitemap program pages, cites each own page, and never fetches gated portals', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url === sitemapUrl) return sitemapXml;
      if (url === externalAwardUrl) {
        return `
          <main>
            <div class="node">
              <h1 id="page-title">Fixture Goldwater Scholarship</h1>
              <p>Supports undergraduate research in the natural sciences and engineering.</p>
              <a href="${communityForceUrl}">Apply</a>
            </div>
          </main>
        `;
      }
      if (url === findFundingProgramUrl) {
        return `
          <main>
            <div class="node">
              <h1 id="page-title">Fixture Light Fellowship</h1>
              <p>Funds intensive language study abroad for undergraduates.</p>
            </div>
          </main>
        `;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [],
      sitemapUrls: [sitemapUrl],
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
    const sourceUrls = emitted
      .filter((observation) => observation.field === 'sourceUrl')
      .map((observation) => observation.value)
      .sort();
    expect(sourceUrls).toEqual([externalAwardUrl, findFundingProgramUrl]);
    expect(sourceUrls).not.toContain(sitemapUrl);

    const goldwaterApplicationLink = emitted.find(
      (observation) =>
        observation.field === 'applicationLink' && observation.entityKey.includes('goldwater'),
    );
    expect(goldwaterApplicationLink?.value).toBe(communityForceUrl);
    expect(fetchPage).not.toHaveBeenCalledWith(communityForceUrl, expect.anything());
    expect(result.metrics?.fellowshipCatalog?.sitemapProgramsDiscovered).toBe(2);
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
    expect(prize?.deadline?.toISOString()).toBe('2027-03-16T03:59:59.999Z');
    expect(prize?.reviewRequired).toBe(false);
    expect(prize?.applicationLink).toBe('https://bit.ly/3rzeOaf');
    expect(prize?.links).toEqual([{ label: 'Application', url: 'https://bit.ly/3rzeOaf' }]);
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

describe('YaleCollegeFellowshipsOfficeScraper cbey funding-opportunities catalog (#675)', () => {
  const cbeyPageUrl = 'https://cbey.yale.edu/funding-opportunities';

  const cbeyCatalogHtml = `
    <main>
      <div class="view__rows">
        <article class="node-teaser node-teaser--program node-teaser--card-vertical" data-node="6739">
          <header class="node-teaser__header">
            <div class="node-teaser__title"><a href="/programs/climate-innovation-grants">Climate Innovation Grants</a></div>
          </header>
          <div class="node-teaser__metadata"><span class="node-teaser__label">Funding Opportunity</span></div>
          <div class="node-teaser__image"><a href="/programs/climate-innovation-grants"><img alt="Fires" /></a></div>
        </article>
        <article class="node-teaser node-teaser--program node-teaser--card-vertical" data-node="6740">
          <header class="node-teaser__header">
            <div class="node-teaser__title"><a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=71">Sobotka Seed Prize for Sustainable Ventures</a></div>
          </header>
          <div class="node-teaser__metadata"><span class="node-teaser__label">Funding Opportunity</span></div>
        </article>
      </div>
    </main>
  `;

  it('extracts program-card candidates with clean titles and same-host detail links', () => {
    const candidates = parseFellowshipCatalogPage(
      cbeyCatalogHtml,
      cbeyPageUrl,
      new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      'Climate Innovation Grants',
      'Sobotka Seed Prize for Sustainable Ventures',
    ]);

    const grants = candidates.find((candidate) => candidate.title === 'Climate Innovation Grants');
    expect(grants?.sourcePageKind).toBe('catalog');
    expect(grants?.reviewRequired).toBe(true);
    expect(grants?.applicationLink).toBeUndefined();
    expect(grants?.links).toEqual([
      {
        label: 'Climate Innovation Grants',
        url: 'https://cbey.yale.edu/programs/climate-innovation-grants',
      },
    ]);
    expect(grants?.contactOffice).toBe('Yale Center for Business and the Environment');

    const prize = candidates.find((candidate) => candidate.title.startsWith('Sobotka Seed Prize'));
    expect(prize?.applicationLink).toBe(
      'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=71',
    );
  });

  const cbeyKeywordlessCardHtml = `
    <main>
      <article class="node-teaser node-teaser--program">
        <header class="node-teaser__header">
          <div class="node-teaser__title"><a href="/programs/fixture-innovation-cohort">Fixture Innovation Cohort</a></div>
        </header>
        <div class="node-teaser__metadata"><span class="node-teaser__label">Funding Opportunity</span></div>
      </article>
    </main>
  `;

  it('surfaces a funding card whose title carries no funding keyword on the cbey host', () => {
    const candidates = parseFellowshipCatalogPage(
      cbeyKeywordlessCardHtml,
      cbeyPageUrl,
      new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual(['Fixture Innovation Cohort']);
  });

  it('does not apply the cbey program adapter on a non-cbey host', () => {
    const candidates = parseFellowshipCatalogPage(
      cbeyKeywordlessCardHtml,
      'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
      new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(candidates).toHaveLength(0);
  });

  it('emits observations for a cbey program candidate', () => {
    const [candidate] = parseFellowshipCatalogPage(
      cbeyCatalogHtml,
      cbeyPageUrl,
      new Date('2026-08-23T00:00:00.000Z'),
    );
    const observations = candidateToObservations(candidate);
    expect(observations.find((obs) => obs.field === 'title')?.value).toBe(
      'Climate Innovation Grants',
    );
    expect(observations.find((obs) => obs.field === 'sourceName')?.value).toBe(
      'yale-college-fellowships-office',
    );
  });
});

describe('YaleCollegeFellowshipsOfficeScraper student-faculty awards index crawl (#1562)', () => {
  const bouchetUrl =
    'https://college.yale.edu/life-at-yale/student-faculty-awards/fixture-bouchet-undergraduate-fellows-program';
  const nakanishiUrl =
    'https://college.yale.edu/life-at-yale/student-faculty-awards/fixture-nakanishi-research-prize';

  const indexHtml = `
    <header><nav><a href="https://college.yale.edu/academics">Academics</a></nav></header>
    <main>
      <h1>Student-Faculty Awards</h1>
      <ul>
        <li><a href="${bouchetUrl}">Fixture Bouchet Undergraduate Fellows Program</a></li>
        <li><a href="${nakanishiUrl}">Fixture Nakanishi Research Prize</a></li>
        <li><a href="https://yale.communityforce.com/Funds/Search.aspx">Student Grants &amp; Fellowships database</a></li>
        <li><a href="${STUDENT_FACULTY_AWARDS_INDEX_URL}">Student-Faculty Awards home</a></li>
      </ul>
    </main>
    <footer><a href="https://college.yale.edu/privacy">Privacy</a></footer>
  `;

  const bouchetHtml = `
    <main>
      <article>
        <h1>Fixture Bouchet Undergraduate Fellows Program</h1>
        <p>The program supports independent undergraduate research projects mentored by Yale faculty. Applications are reviewed on a rolling basis.</p>
        <a href="https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=810">Apply through the Student Grants Database</a>
      </article>
    </main>
  `;

  const nakanishiHtml = `
    <main>
      <article>
        <h1>Fixture Nakanishi Research Prize</h1>
        <p>The prize recognizes outstanding undergraduate research projects on race, ethnicity, and migration.</p>
        <a href="https://studentgrants.yale.edu/">Student Grants &amp; Fellowships database</a>
      </article>
    </main>
  `;

  it('discovers child award pages from the index while excluding nav, portal, and index-root links', () => {
    const childUrls = extractIndexSeedChildDetailUrls(indexHtml, STUDENT_FACULTY_AWARDS_INDEX_URL);
    expect(childUrls).toEqual([bouchetUrl, nakanishiUrl]);
    expect(childUrls).not.toContain(STUDENT_FACULTY_AWARDS_INDEX_URL);
    expect(childUrls.some((url) => url.includes('communityforce.com'))).toBe(false);
    expect(childUrls.some((url) => url.includes('/academics') || url.includes('/privacy'))).toBe(
      false,
    );
  });

  it('never parses the index root itself into a candidate', () => {
    const candidates = parseFellowshipCatalogPage(
      indexHtml,
      STUDENT_FACULTY_AWARDS_INDEX_URL,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(candidates.every((candidate) => candidate.title !== 'Student-Faculty Awards')).toBe(
      true,
    );
  });

  it('cites each discovered program page as its own source and never the index root', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url === STUDENT_FACULTY_AWARDS_INDEX_URL) return indexHtml;
      if (url === bouchetUrl) return bouchetHtml;
      if (url === nakanishiUrl) return nakanishiHtml;
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [STUDENT_FACULTY_AWARDS_INDEX_URL],
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
    const sourceUrls = emitted
      .filter((obs) => obs.field === 'sourceUrl')
      .map((obs) => obs.value)
      .sort();
    expect(sourceUrls).toEqual([bouchetUrl, nakanishiUrl].sort());
    expect(emitted.some((obs) => obs.value === STUDENT_FACULTY_AWARDS_INDEX_URL)).toBe(false);
    expect(emitted.every((obs) => obs.sourceUrl !== STUDENT_FACULTY_AWARDS_INDEX_URL)).toBe(true);
  });

  it('carries CommunityForce and studentgrants links as application links, never as sources', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url === STUDENT_FACULTY_AWARDS_INDEX_URL) return indexHtml;
      if (url === bouchetUrl) return bouchetHtml;
      if (url === nakanishiUrl) return nakanishiHtml;
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [STUDENT_FACULTY_AWARDS_INDEX_URL],
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

    expect(fetchPage).not.toHaveBeenCalledWith(
      'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=810',
      expect.anything(),
    );
    expect(fetchPage).not.toHaveBeenCalledWith(
      'https://studentgrants.yale.edu/',
      expect.anything(),
    );

    const applicationLinks = emitted
      .filter((obs) => obs.field === 'applicationLink')
      .map((obs) => obs.value);
    expect(applicationLinks).toContain(
      'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=810',
    );
    expect(applicationLinks).toContain('https://studentgrants.yale.edu/');
    const sourceUrls = emitted.filter((obs) => obs.field === 'sourceUrl').map((obs) => obs.value);
    expect(sourceUrls.some((url) => url.includes('communityforce.com'))).toBe(false);
    expect(sourceUrls.some((url) => url.includes('studentgrants.yale.edu'))).toBe(false);
  });

  it('drops a child page that fails to fetch rather than citing the index root (fail closed)', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url === STUDENT_FACULTY_AWARDS_INDEX_URL) return indexHtml;
      if (url === bouchetUrl) return bouchetHtml;
      if (url === nakanishiUrl) throw new Error('Request failed with status code 404');
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [STUDENT_FACULTY_AWARDS_INDEX_URL],
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

    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('Skipped 1 fellowship page');
    expect(emitted.find((obs) => obs.field === 'sourceUrl')?.value).toBe(bouchetUrl);
    expect(emitted.every((obs) => obs.sourceUrl !== STUDENT_FACULTY_AWARDS_INDEX_URL)).toBe(true);
  });
});

describe('YaleCollegeFellowshipsOfficeScraper STEM fellowships hub crawl (#1564)', () => {
  const starsUrl = `${STEM_FELLOWSHIPS_FUNDING_HUB_URL}/stars/stars-i-academic-year-program`;
  const biomedUrl = 'https://medicine.yale.edu/biomedsurf/';
  const sumryUrl = 'https://sumry.yale.edu/sumry';
  const crispUrl =
    'https://crisp.yale.edu/education/crisp-research-experiences-undergraduates-reu-program';
  const gsasUrl =
    'https://gsas.yale.edu/programs-of-study/summer-undergraduate-research-fellowship-program';
  const sroUrl = 'https://economics.yale.edu/undergraduate/sro';
  const hixonPortalUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=hixon';

  const hubHtml = `
    <header><nav><a href="https://science.yalecollege.yale.edu/academics">Academics</a></nav></header>
    <main>
      <h1>Funding STEM Opportunities at Yale</h1>
      <a href="https://science.yalecollege.yale.edu/stem-fellowships">STEM Fellowships home</a>
      <a href="${STEM_FELLOWSHIPS_FUNDING_HUB_URL}">Funding STEM Opportunities at Yale</a>
      <ul>
        <li><a href="${starsUrl}">STARS I Academic Year Program</a></li>
        <li><a href="${biomedUrl}">BioMed SURF (Amgen Scholars)</a></li>
        <li><a href="${sumryUrl}">Summer Undergraduate Math Research at Yale (SUMRY)</a></li>
        <li><a href="${crispUrl}">CRISP Research Experience for Undergraduates (REU)</a></li>
        <li><a href="${gsasUrl}">Summer Undergraduate Research Fellowship (SURF)</a></li>
        <li><a href="${sroUrl}">SRO (Summer Research Opportunities) in Economics</a></li>
        <li><a href="${hixonPortalUrl}">Alexander P. Hixon Fellowship</a></li>
      </ul>
    </main>
    <footer><a href="https://science.yalecollege.yale.edu/contact">Contact</a></footer>
  `;

  it('discovers STEM child program pages across subdomains while excluding nav, portal, hub root, and the stem-fellowships landing', () => {
    const childUrls = extractIndexSeedChildDetailUrls(hubHtml, STEM_FELLOWSHIPS_FUNDING_HUB_URL);
    expect(childUrls.sort()).toEqual(
      [starsUrl, biomedUrl, sumryUrl, crispUrl, gsasUrl, sroUrl].sort(),
    );
    expect(childUrls).not.toContain(STEM_FELLOWSHIPS_FUNDING_HUB_URL);
    expect(childUrls).not.toContain('https://science.yalecollege.yale.edu/stem-fellowships');
    expect(childUrls.some((url) => url.includes('communityforce.com'))).toBe(false);
    expect(childUrls.some((url) => url.includes('/academics') || url.includes('/contact'))).toBe(
      false,
    );
  });

  it('never parses the hub root itself into a candidate', () => {
    const candidates = parseFellowshipCatalogPage(
      hubHtml,
      STEM_FELLOWSHIPS_FUNDING_HUB_URL,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(
      candidates.every((candidate) => candidate.title !== 'Funding STEM Opportunities at Yale'),
    ).toBe(true);
  });

  it('mints a terse-titled program page reached from the hub and cites its own page', async () => {
    const biomedHtml = `
      <main>
        <article>
          <h1>Yale BioMed Amgen Scholars Program</h1>
          <p>The program places undergraduates in mentored summer biomedical research laboratories.</p>
          <a href="${hixonPortalUrl}">Apply through the application portal</a>
        </article>
      </main>
    `;
    const sumryHtml = `
      <main>
        <article>
          <h1>SUMRY</h1>
          <p>The Summer Undergraduate Math Research at Yale program supports undergraduate mathematics research.</p>
        </article>
      </main>
    `;
    const starsHtml = `
      <main>
        <article>
          <h1>STARS I Academic Year Program</h1>
          <p>Students conduct faculty-mentored research during the academic year.</p>
        </article>
      </main>
    `;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === STEM_FELLOWSHIPS_FUNDING_HUB_URL) return hubHtml;
      if (url === biomedUrl) return biomedHtml;
      if (url === sumryUrl) return sumryHtml;
      if (url === starsUrl) return starsHtml;
      throw new Error('Request failed with status code 404');
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [STEM_FELLOWSHIPS_FUNDING_HUB_URL],
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

    const titles = emitted.filter((obs) => obs.field === 'title').map((obs) => obs.value);
    expect(titles).toContain('SUMRY');
    expect(titles).toContain('Yale BioMed Amgen Scholars Program');
    expect(titles).toContain('STARS I Academic Year Program');

    const sumryObservations = emitted.filter(
      (obs) => obs.entityKey === 'yale-college-fellowships-office:sumry',
    );
    expect(sumryObservations.find((obs) => obs.field === 'sourceUrl')?.value).toBe(sumryUrl);

    const sourceUrls = emitted.filter((obs) => obs.field === 'sourceUrl').map((obs) => obs.value);
    expect(sourceUrls).not.toContain(STEM_FELLOWSHIPS_FUNDING_HUB_URL);
    expect(emitted.every((obs) => obs.sourceUrl !== STEM_FELLOWSHIPS_FUNDING_HUB_URL)).toBe(true);
  });

  it('carries a hub-linked CommunityForce portal as an application link, never a fetch target', async () => {
    const biomedHtml = `
      <main>
        <article>
          <h1>Yale BioMed Amgen Scholars Program</h1>
          <p>The program places undergraduates in mentored summer biomedical research laboratories.</p>
          <a href="${hixonPortalUrl}">Apply through the application portal</a>
        </article>
      </main>
    `;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === STEM_FELLOWSHIPS_FUNDING_HUB_URL) {
        return `
          <main>
            <h1>Funding STEM Opportunities at Yale</h1>
            <ul><li><a href="${biomedUrl}">BioMed SURF (Amgen Scholars)</a></li></ul>
          </main>
        `;
      }
      if (url === biomedUrl) return biomedHtml;
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [STEM_FELLOWSHIPS_FUNDING_HUB_URL],
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

    expect(fetchPage).not.toHaveBeenCalledWith(hixonPortalUrl, expect.anything());
    const applicationLinks = emitted
      .filter((obs) => obs.field === 'applicationLink')
      .map((obs) => obs.value);
    expect(applicationLinks).toContain(hixonPortalUrl);
    const sourceUrls = emitted.filter((obs) => obs.field === 'sourceUrl').map((obs) => obs.value);
    expect(sourceUrls.some((url) => url.includes('communityforce.com'))).toBe(false);
  });

  it('drops a hub child that fails to fetch rather than citing the hub root (fail closed)', async () => {
    const starsHtml = `
      <main>
        <article>
          <h1>STARS I Academic Year Program</h1>
          <p>Students conduct faculty-mentored research during the academic year.</p>
        </article>
      </main>
    `;
    const fetchPage = vi.fn(async (url: string) => {
      if (url === STEM_FELLOWSHIPS_FUNDING_HUB_URL) {
        return `
          <main>
            <h1>Funding STEM Opportunities at Yale</h1>
            <ul>
              <li><a href="${starsUrl}">STARS I Academic Year Program</a></li>
              <li><a href="${sumryUrl}">Summer Undergraduate Math Research at Yale (SUMRY)</a></li>
            </ul>
          </main>
        `;
      }
      if (url === starsUrl) return starsHtml;
      if (url === sumryUrl) throw new Error('Request failed with status code 404');
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [STEM_FELLOWSHIPS_FUNDING_HUB_URL],
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

    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('Skipped 1 fellowship page');
    expect(emitted.find((obs) => obs.field === 'sourceUrl')?.value).toBe(starsUrl);
    expect(emitted.every((obs) => obs.sourceUrl !== STEM_FELLOWSHIPS_FUNDING_HUB_URL)).toBe(true);
  });
});

describe('YaleCollegeFellowshipsOfficeScraper MacMillan council grant pages (#1566)', () => {
  const latamUrl = 'https://macmillan.yale.edu/latam/student-grants-and-prizes';
  const southAsiaUrl = 'https://macmillan.yale.edu/southasia/undergraduate-grants';
  const communityForcePortalUrl =
    'https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=latamsummer';

  const latamHtml = `
    <header><nav><a href="https://macmillan.yale.edu/people">People</a></nav></header>
    <main>
      <div class="node node--page node--full">
        <div class="node__header"><h1 class="node__heading">Student Grants and Prizes</h1></div>
        <div class="node__content">
          <p>The Council on Latin American &amp; Iberian Studies awards undergraduate summer research grants supporting original independent research projects in Latin America mentored by Yale faculty. Applications are reviewed on a rolling basis.</p>
          <p><strong>How to apply:</strong> Submit a research proposal, a budget, and a faculty mentor letter of support.</p>
          <a href="${communityForcePortalUrl}">Apply through the Student Grants Database</a>
          <a href="${MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT}">All undergraduate research grants</a>
        </div>
      </div>
    </main>
    <footer><a href="https://macmillan.yale.edu/privacy">Privacy</a></footer>
  `;

  const southAsiaHtml = `
    <main>
      <div class="node node--page node--full">
        <div class="node__header"><h1 class="node__heading">Undergraduate Grants and Prizes</h1></div>
        <div class="node__content">
          <p>The South Asian Studies Council offers senior essay research grants and travel grants for undergraduates undertaking independent research on South Asia.</p>
          <a href="https://studentgrants.yale.edu/">Student Grants &amp; Fellowships database</a>
        </div>
      </div>
    </main>
  `;

  it('seeds each canonical council grant page and never the dead aggregate root', () => {
    for (const url of MACMILLAN_COUNCIL_GRANT_PAGE_URLS) {
      expect(DEFAULT_PAGE_URLS as readonly string[], url).toContain(url);
    }
    expect(DEFAULT_PAGE_URLS as readonly string[]).not.toContain(
      MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT,
    );
  });

  it('parses a council grant page into one program citing its own canonical page', () => {
    const candidates = parseFellowshipCatalogPage(
      latamHtml,
      latamUrl,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate.title).toBe('Student Grants and Prizes');
    expect(candidate.sourceUrl).toBe(latamUrl);
    expect(candidate.sourcePageKind).toBe('detail');
    expect(candidate.researchFocused).toBe(true);
    expect(candidate.applicationLink).toBe(communityForcePortalUrl);
    expect(candidate.applicationMaterials).toContain('Research proposal');
    expect(candidate.applicationMaterials).toContain('Faculty mentor support');
  });

  it('records a thin single-program council page as facts and leaves it for archive review', () => {
    const [candidate] = parseFellowshipCatalogPage(
      southAsiaHtml,
      southAsiaUrl,
      new Date('2026-01-01T00:00:00Z'),
    );
    const observations = candidateToObservations(candidate);
    expect(observations.find((obs) => obs.field === 'sourceName')?.value).toBe(
      'yale-college-fellowships-office',
    );
    expect(observations.find((obs) => obs.field === 'sourceUrl')?.value).toBe(southAsiaUrl);
    expect(observations.find((obs) => obs.field === 'title')?.value).toBe(
      'Undergraduate Grants and Prizes',
    );
    expect(classifierFieldsIn(observations)).toEqual([]);
    expect(classificationFromObservedFacts(observations)).toMatchObject({
      programKind: 'OTHER',
      studentFacingCategory: 'Archive / review',
    });
  });

  it('never mints the aggregate listing root as a self-citing detail candidate', () => {
    const candidates = parseFellowshipCatalogPage(
      latamHtml,
      MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(
      candidates.every(
        (candidate) =>
          !(
            candidate.sourcePageKind === 'detail' &&
            candidate.sourceUrl === MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT
          ),
      ),
    ).toBe(true);
  });

  it('cites each council page as its own source and never the aggregate root, with portals as application links only', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url === latamUrl) return latamHtml;
      if (url === southAsiaUrl) return southAsiaHtml;
      throw new Error(`unexpected fetch ${url}`);
    });
    const emitted: any[] = [];
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [latamUrl, southAsiaUrl],
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
    const sourceUrls = emitted
      .filter((obs) => obs.field === 'sourceUrl')
      .map((obs) => obs.value)
      .sort();
    expect(sourceUrls).toEqual([latamUrl, southAsiaUrl].sort());
    expect(
      emitted.every((obs) => obs.sourceUrl !== MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT),
    ).toBe(true);
    expect(fetchPage).not.toHaveBeenCalledWith(communityForcePortalUrl, expect.anything());
    expect(fetchPage).not.toHaveBeenCalledWith(
      'https://studentgrants.yale.edu/',
      expect.anything(),
    );
    expect(fetchPage).not.toHaveBeenCalledWith(
      MACMILLAN_UNDERGRADUATE_RESEARCH_GRANTS_ROOT,
      expect.anything(),
    );

    const applicationLinks = emitted
      .filter((obs) => obs.field === 'applicationLink')
      .map((obs) => obs.value);
    expect(applicationLinks).toContain(communityForcePortalUrl);
    expect(applicationLinks).toContain('https://studentgrants.yale.edu/');
  });
});

describe('YaleCollegeFellowshipsOfficeScraper third-party application routes (#4086)', () => {
  const departmentProgramUrl =
    'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program';

  const pageWithApplyButton = (href: string, anchorText = 'Apply Now') => `
        <main>
          <h1>Fixture Department Research Internship Program</h1>
          <p>
            Interns conduct an independent research project with a faculty mentor.
            <a href="${href}">${anchorText}</a>
          </p>
        </main>
      `;

  it('keeps a Google Form apply button as the application route', () => {
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton('http://forms.gle/FIXTUREFORMKEY1'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBe('https://forms.gle/FIXTUREFORMKEY1');
    expect(candidates[0]?.links).toEqual([
      { label: 'Apply Now', url: 'https://forms.gle/FIXTUREFORMKEY1' },
    ]);
  });

  it.each([
    ['https://apply.interfolio.com/00000', 'Start your application'],
    ['https://fixture.slideroom.com/permalink/program/00000', 'Submit materials'],
    ['https://fixture.submittable.com/submit', 'Submit'],
  ])('keeps an application-management portal route: %s', (href, anchorText) => {
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton(href, anchorText),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBe(href);
  });

  it('keeps an application-management portal route even when the anchor text does not say apply', () => {
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton('https://apply.interfolio.com/00000', 'Program portal'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBe('https://apply.interfolio.com/00000');
  });

  it('ignores a general-purpose form host the page does not present as the application', () => {
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton(
        'https://fixture.qualtrics.com/jfe/form/SV_0000',
        'Tell us what you think',
      ),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBeUndefined();
    expect(candidates[0]?.links).toEqual([]);
  });

  it('keeps a Google Forms document path but not an unrelated Google Docs link', () => {
    const [applicationForm] = parseFellowshipCatalogPage(
      pageWithApplyButton('https://docs.google.com/forms/d/e/1FAIpQLSfixture/viewform'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(applicationForm?.applicationLink).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQLSfixture/viewform',
    );

    const [spreadsheet] = parseFellowshipCatalogPage(
      pageWithApplyButton('https://docs.google.com/spreadsheets/d/1fixture/edit', 'Apply Now'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(spreadsheet?.applicationLink).toBeUndefined();
  });

  it('still refuses a portal URL whose only specificity is a fragment', () => {
    // A hash-routed portal link normalizes to a bare root, which the shared
    // bare-root guard refuses for the same reason it refuses a site homepage.
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton('https://fixture.slideroom.com/#/permalink/program/00000'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBeUndefined();
  });

  it('upgrades a plaintext portal route to https so an application is not submitted in the clear', () => {
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton('http://forms.gle/FIXTUREFORMKEY1'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBe('https://forms.gle/FIXTUREFORMKEY1');
  });

  it('does not admit a lookalike host that merely ends with a portal domain', () => {
    const candidates = parseFellowshipCatalogPage(
      pageWithApplyButton('https://notforms.gle.example.com/apply', 'Apply Now'),
      departmentProgramUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]?.applicationLink).toBeUndefined();
  });
});

describe('YaleCollegeFellowshipsOfficeScraper inferred purpose (#4086)', () => {
  it('does not read a Study purpose out of the idiom "of course"', () => {
    expect(inferPurpose('Can I contact a faculty member directly? Yes of course!')).not.toContain(
      'Study',
    );
  });

  it('does not read a Travel purpose out of international eligibility prose', () => {
    expect(
      inferPurpose(
        'Does the program consider International Students? Yes! We have had international student interns.',
      ),
    ).not.toContain('Travel');
  });

  it('does not read a Travel purpose out of a FAQ declining to cover travel', () => {
    expect(
      inferPurpose('Does the program cover my travel cost? It depends on the research projects.'),
    ).not.toContain('Travel');
  });

  it('does not read a Service purpose out of an unrelated use of the word service', () => {
    expect(inferPurpose('Interns receive dining hall and health service access.')).not.toContain(
      'Service',
    );
  });

  it('still reads the purpose a page states', () => {
    expect(inferPurpose('This travel grant supports conference attendance.')).toContain('Travel');
    expect(inferPurpose('Supports a summer of study abroad.')).toEqual(
      expect.arrayContaining(['Study', 'Travel']),
    );
    expect(inferPurpose('Covers tuition for an approved course of study.')).toContain('Study');
    expect(inferPurpose('A public service fellowship for rising seniors.')).toContain('Service');
    expect(inferPurpose('Funds an independent research project with a faculty mentor.')).toContain(
      'Research',
    );
  });
});

describe('YaleCollegeFellowshipsOfficeScraper administering office (#4086)', () => {
  const programHtml = `
        <main>
          <h1>Fixture Undergraduate Research Fellowship</h1>
          <p>Supports an independent research project with a faculty mentor.</p>
        </main>
      `;

  const officeFor = (pageUrl: string) => {
    const [candidate] = parseFellowshipCatalogPage(
      programHtml,
      pageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );
    return candidate?.contactOffice;
  };

  it('names the fellowships office for a page on the office’s own site', () => {
    expect(
      officeFor('https://funding.yale.edu/find-funding/fixture-undergraduate-research-fellowship'),
    ).toBe('Yale Fellowships and Funding');
  });

  it('claims no office for a page on a department or school site', () => {
    expect(
      officeFor(
        'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
      ),
    ).toBe('');
    expect(officeFor('https://economics.yale.edu/undergraduate/tobin-ra-fellowship')).toBe('');
  });

  it('asserts the empty office so a re-read clears a row that carries the wrong one', () => {
    const [candidate] = parseFellowshipCatalogPage(
      programHtml,
      'https://economics.yale.edu/undergraduate/tobin-ra-fellowship',
      new Date('2026-01-01T00:00:00Z'),
    );
    const contactOffice = candidateToObservations(candidate).find(
      (obs) => obs.field === 'contactOffice',
    );

    expect(contactOffice).toBeDefined();
    expect(contactOffice?.value).toBe('');
  });
});

describe('YaleCollegeFellowshipsOfficeScraper benchmark replay', () => {
  it('reads every page from the frozen input, including a page that failed at capture', async () => {
    const servedUrl = `${detailPageUrl}-served`;
    const failedUrl = `${detailPageUrl}-failed`;
    const emitted: any[] = [];
    const log = vi.fn();
    beginBenchmarkReplay([
      {
        sourceName: 'yale-college-fellowships-office',
        requestKey: `page:${servedUrl}`,
        payload:
          '<main><h1>Fixture Frozen Research Fellowship</h1><p>Students research.</p></main>',
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        sourceName: POLICY_FETCH_BENCHMARK_NAMESPACE,
        requestKey: `page:v1:${failedUrl}`,
        payload: { failedStatus: 404 },
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    let replay;
    try {
      await new YaleCollegeFellowshipsOfficeScraper({
        pageUrls: [servedUrl, failedUrl],
        sitemapUrls: [],
        retryDelay: async () => undefined,
      }).run({
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-college-fellowships-office',
        sourceWeight: 0.95,
        options: { dryRun: true, useCache: true, release: false },
        emit: async (items) => {
          emitted.push(...(Array.isArray(items) ? items : [items]));
        },
        log,
      });
    } finally {
      replay = finishBenchmarkReplay();
    }

    expect(replay.networkBlocks).toBe(0);
    expect(replay.servedByNamespace).toEqual({
      'yale-college-fellowships-office': 1,
      [POLICY_FETCH_BENCHMARK_NAMESPACE]: 1,
    });
    expect(emitted.find((observation) => observation.field === 'title')?.value).toBe(
      'Fixture Frozen Research Fellowship',
    );
    expect(log).toHaveBeenCalledWith(
      'Skipping fellowship catalog page after fetch/parse failure',
      expect.objectContaining({ url: failedUrl }),
    );
  });
});

describe('YaleCollegeFellowshipsOfficeScraper reference date (#4132)', () => {
  const programUrl =
    'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/fixture-clock-fellowship';
  const html = `
    <main>
      <h1>Fixture Clock Research Fellowship</h1>
      <p>Supports an independent research project.</p>
      <p>Deadline: March 1</p>
    </main>`;

  const plannedDeadline = async (referenceDate: Date | undefined) => {
    const emitted: any[] = [];
    await new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [programUrl],
      fetchPage: vi.fn(async () => html),
    }).run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        ...(referenceDate ? { referenceDate } : {}),
      },
      emit: async (items) => {
        emitted.push(...(Array.isArray(items) ? items : [items]));
      },
      log: vi.fn(),
    });
    const deadline = emitted.find((observation) => observation.field === 'deadline')?.value;
    return deadline ? new Date(deadline).toISOString() : undefined;
  };

  it('infers an undated deadline from the pinned reference date, not the wall clock', async () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-06-15T12:00:00Z');

    expect(await plannedDeadline(winter)).toBe(
      parseProgramDate('Deadline: March 1', 'deadline', winter)?.toISOString(),
    );
    expect(await plannedDeadline(summer)).toBe(
      parseProgramDate('Deadline: March 1', 'deadline', summer)?.toISOString(),
    );
    expect(await plannedDeadline(winter)).not.toBe(await plannedDeadline(summer));
  });

  it('gives the same planned deadline on every run pinned to the same moment', async () => {
    const pinned = new Date('2026-01-15T12:00:00Z');
    expect(await plannedDeadline(pinned)).toBe(await plannedDeadline(pinned));
  });
});

describe('YaleCollegeFellowshipsOfficeScraper pages that are not programs (#4110)', () => {
  const officePageUrl = 'https://funding.yale.edu/fixture-fellowships-roundup';
  const councilPageUrl =
    'https://macmillan.yale.edu/fixture-council/student-grants-and-fellowships';
  const referenceDate = new Date('2026-01-01T00:00:00Z');
  const fundRecord = (fixture: string) =>
    `https://yale.communityforce.com/Funds/FundDetails.aspx?fixture=${fixture}`;

  const pageWith = (title: string, body: string, bodyClass = 'node-type-static-page') => `
    <html><body class="html not-front ${bodyClass}">
      <header><nav><a href="https://funding.yale.edu/find-funding">Find Funding</a></nav></header>
      <div class="node node-static-page">
        <h1>${title}</h1>
        ${body}
      </div>
    </body></html>
  `;

  const programPage = pageWith(
    'Fixture Summer Research Fellowship',
    `
      <p>The fellowship funds ten weeks of mentored summer research for Yale College students.</p>
      <h2>Eligibility</h2>
      <p>Open to first-year and sophomore students.</p>
      <h2>The Award</h2>
      <p>Fellows receive a stipend.</p>
      <a href="${fundRecord('summer')}">Apply through the Student Grants Database</a>
    `,
  );

  const runScraper = async (scraper: YaleCollegeFellowshipsOfficeScraper) => {
    const emitted: any[] = [];
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
    return { emitted, result };
  };

  it('refuses a page the site publishes as a post rather than an award record', () => {
    const read = readFellowshipCatalogPage(
      pageWith(
        'Fixture Fellowships Flyer Series',
        '<p>Download this year of fellowship flyers.</p>',
        'node-type-narrative',
      ),
      officePageUrl,
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('cms-post');
  });

  it('refuses a roundup of award news that links dated articles', () => {
    const articles = [1, 2, 3]
      .map(
        (day) =>
          `<h3>Fixture scholars named</h3><a href="https://news.yale.edu/2026/04/0${day}/fixture-scholars-named">Read More</a>`,
      )
      .join('');
    const read = readFellowshipCatalogPage(
      pageWith('Fixture Fellowships in the News', articles),
      officePageUrl,
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('news-roundup');
  });

  it('refuses a page that lists several programs, each with its own fund record', () => {
    const read = readFellowshipCatalogPage(
      pageWith(
        'Student Grants and Fellowships',
        `
          <p>The council offers the following grants.</p>
          <a href="${fundRecord('language')}">Fixture Language Study Grant</a>
          <a href="${fundRecord('travel')}">Fixture Travel Grant</a>
        `,
      ),
      councilPageUrl,
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('program-hub');
  });

  it('refuses a page whose sections each describe a different award', () => {
    const read = readFellowshipCatalogPage(
      pageWith(
        'Undergraduate Grants and Prizes',
        `
          <h2>Fixture Senior Essay Prize</h2><p>Awarded for an exceptional senior essay.</p>
          <h2>Fixture Travel Research Grant</h2><p>Supports summer research travel.</p>
          <h2>Fixture Language Study Awards</h2><p>Supports summer language study.</p>
        `,
      ),
      councilPageUrl,
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('program-hub');
  });

  it('refuses a sign-in wall served in place of the page', () => {
    const read = readFellowshipCatalogPage(
      `
        <html><body>
          <h1>Central Authentication Service</h1>
          <form action="login" method="post">
            <input type="text" name="username" /><input type="password" name="password" />
          </form>
        </body></html>
      `,
      'https://funding.yale.edu/fellowship/fixture-government-fellowship',
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('sign-in-wall');
  });

  it('keeps a program page whose sections describe the one award it offers', () => {
    const read = readFellowshipCatalogPage(programPage, officePageUrl, referenceDate);

    expect(read.refusedPage).toBeUndefined();
    expect(read.candidates.map((candidate) => candidate.title)).toEqual([
      'Fixture Summer Research Fellowship',
    ]);
  });

  it.each([
    [
      'section headings that each mention the award',
      `
        <h2>Fellowship Benefits</h2><p>Fellows receive a stipend.</p>
        <h2>Program Requirements</h2><p>Fellows present a poster.</p>
        <h2>Grant Timeline</h2><p>Funds are disbursed in May.</p>
      `,
    ],
    [
      'links to dated stories about past fellows',
      [1, 2, 3]
        .map(
          (day) =>
            `<a href="https://news.yale.edu/2025/06/0${day}/fixture-past-fellow-story">Read about a past fellow</a>`,
        )
        .join(''),
    ],
    [
      'a fund record per term and links to related programs',
      `
        <a href="${fundRecord('summer-term')}">Apply for the summer term</a>
        <a href="${fundRecord('fall-term')}">Apply for the fall term</a>
        <p>Related:</p>
        <a href="https://funding.yale.edu/fellowships/fixture-alpha-fellowship">Fixture Alpha Fellowship</a>
        <a href="https://funding.yale.edu/fellowships/fixture-beta-grant">Fixture Beta Grant</a>
        <a href="https://funding.yale.edu/fellowships/fixture-gamma-prize">Fixture Gamma Prize</a>
      `,
    ],
  ])('keeps a page titled as one award that carries %s', (_shape, body) => {
    const read = readFellowshipCatalogPage(
      pageWith(
        'Fixture Summer Research Fellowship',
        `<p>Ten weeks of mentored research.</p>${body}`,
      ),
      officePageUrl,
      referenceDate,
    );

    expect(read.refusedPage).toBeUndefined();
    expect(read.candidates.map((candidate) => candidate.title)).toEqual([
      'Fixture Summer Research Fellowship',
    ]);
  });

  it('keeps a program page that shows a news teaser in its sidebar', () => {
    const html = programPage.replace(
      '</body>',
      `<aside class="layout-sidebar"><article class="node node--type-news node--view-mode-teaser">
        <a href="https://funding.yale.edu/news/fixture-update">Fixture update</a>
      </article></aside></body>`,
    );
    const read = readFellowshipCatalogPage(html, officePageUrl, referenceDate);

    expect(read.refusedPage).toBeUndefined();
    expect(read.candidates.map((candidate) => candidate.title)).toEqual([
      'Fixture Summer Research Fellowship',
    ]);
  });

  it('still reads a catalog page that lists many fund records as a catalog', () => {
    const rows = ['Fixture Alpha Research Fellowship', 'Fixture Beta Travel Grant']
      .map(
        (title, index) =>
          `<li><a href="${fundRecord(`catalog-${index}`)}">${title}</a> Deadline: March 1, 2026</li>`,
      )
      .join('');
    const read = readFellowshipCatalogPage(
      pageWith('Yale Fellowships offered through the Office of Fellowships', `<ul>${rows}</ul>`),
      fundingPageUrl,
      referenceDate,
    );

    expect(read.refusedPage).toBeUndefined();
    expect(read.candidates.map((candidate) => candidate.title).sort()).toEqual([
      'Fixture Alpha Research Fellowship',
      'Fixture Beta Travel Grant',
    ]);
  });

  it('matches only the row a refused page minted for itself, never a program it cites', () => {
    const refused = {
      url: councilPageUrl,
      shape: 'program-hub' as const,
      sourceKey: sourceKeyForTitle('Student Grants and Fellowships'),
      title: 'Student Grants and Fellowships',
    };
    const selfRow = {
      sourceKey: refused.sourceKey,
      title: 'Student Grants and Fellowships',
      sourceUrl: councilPageUrl,
    };
    const listedRow = {
      sourceKey: sourceKeyForTitle('Fixture Travel Grant'),
      title: 'Fixture Travel Grant',
      sourceUrl: councilPageUrl,
    };
    const sameTitleElsewhere = {
      sourceKey: 'yale-college-fellowships-office:other',
      title: 'Student Grants and Fellowships',
      sourceUrl: 'https://macmillan.yale.edu/other-council/student-grants-and-fellowships',
    };

    const matches = rowsMintedByRefusedPages(
      [selfRow, listedRow, sameTitleElsewhere],
      [refused],
      new Set(),
    );

    expect(matches.map((match) => match.row.sourceKey)).toEqual([refused.sourceKey]);
    expect(rowsMintedByRefusedPages([selfRow], [refused], new Set([refused.sourceKey]))).toEqual(
      [],
    );
  });

  it('retires the row a refused page minted, and a re-run re-derives the same answer', async () => {
    const newsHtml = pageWith(
      'Fixture Fellowships in the News',
      [1, 2, 3]
        .map(
          (day) =>
            `<a href="https://news.yale.edu/2026/05/0${day}/fixture-award-news">Read More</a>`,
        )
        .join(''),
    );
    const programUrl = 'https://funding.yale.edu/fellowships/fixture-summer-research-fellowship';
    const newsKey = sourceKeyForTitle('Fixture Fellowships in the News');
    const programKey = sourceKeyForTitle('Fixture Summer Research Fellowship');
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [officePageUrl, programUrl],
      sitemapUrls: [],
      fetchPage: async (url: string) => {
        if (url === officePageUrl) return newsHtml;
        if (url === programUrl) return programPage;
        throw new Error(`unexpected fetch ${url}`);
      },
      loadOwnedRows: async () => [
        { sourceKey: newsKey, title: 'Fixture Fellowships in the News', sourceUrl: officePageUrl },
        {
          sourceKey: programKey,
          title: 'Fixture Summer Research Fellowship',
          sourceUrl: programUrl,
        },
      ],
    });

    for (const { emitted, result } of [await runScraper(scraper), await runScraper(scraper)]) {
      const archived = emitted.filter((obs) => obs.field === 'archived');
      expect(archived).toHaveLength(2);
      expect(archived).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityKey: newsKey, value: true, sourceUrl: officePageUrl }),
          expect.objectContaining({ entityKey: programKey, value: false }),
        ]),
      );
      expect(emitted.some((obs) => obs.entityKey === newsKey && obs.field !== 'archived')).toBe(
        false,
      );
      expect(result.metrics?.fellowshipCatalog?.nonProgramRowsRetired).toBe(1);
      expect(result.metrics?.fellowshipCatalog?.nonProgramPagesRefused).toEqual({
        'news-roundup': 1,
      });
    }
  });

  it('does not read the stored rows when no page was refused', async () => {
    const loadOwnedRows = vi.fn(async () => []);
    const scraper = new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: ['https://funding.yale.edu/fellowships/fixture-summer-research-fellowship'],
      sitemapUrls: [],
      fetchPage: async () => programPage,
      loadOwnedRows,
    });

    await runScraper(scraper);

    expect(loadOwnedRows).not.toHaveBeenCalled();
  });
});

describe('YaleCollegeFellowshipsOfficeScraper collective and advising pages (#4110)', () => {
  const referenceDate = new Date('2026-01-01T00:00:00Z');
  const page = (title: string, body: string, contentType: string) => `
    <html><body class="html not-front node-type-${contentType}">
      <div class="node node-${contentType}">
        <h1>${title}</h1>
        ${body}
      </div>
    </body></html>
  `;

  it('refuses a collective award title whose sections each name a different award', () => {
    const read = readFellowshipCatalogPage(
      page(
        'Fixture Teaching Prizes',
        `
          <h2>The Fixture Alpha Prize for Teaching Excellence</h2><p>Awarded each spring.</p>
          <h2>The Fixture Beta Prize</h2><p>Awarded each spring.</p>
          <h2>The Fixture Gamma Award</h2><p>Awarded each spring.</p>
        `,
        'page',
      ),
      'https://college.yale.edu/life-at-yale/student-faculty-awards/fixture-teaching-prizes',
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('program-hub');
  });

  it('refuses a generic site page whose title names no award', () => {
    const read = readFellowshipCatalogPage(
      page(
        'Fixture Notes on Letters of Reference',
        '<p>Guidance for recommenders writing for the campus endorsement process.</p>',
        'static-page',
      ),
      'https://funding.yale.edu/fellowships/fixture-notes-letters',
      referenceDate,
    );

    expect(read.candidates).toEqual([]);
    expect(read.refusedPage?.shape).toBe('advising-page');
  });

  it.each([
    ['a generic site page titled as an award', 'Fixture Experience Grant (FEG)', 'static-page'],
    [
      'a dedicated award record whose title names no award noun',
      'Fixture in Asia',
      'external-award',
    ],
  ])('keeps %s', (_case, title, contentType) => {
    const read = readFellowshipCatalogPage(
      page(title, '<p>Funds a summer of independent work for eligible students.</p>', contentType),
      'https://funding.yale.edu/fellowships/fixture-award-page',
      referenceDate,
    );

    expect(read.refusedPage).toBeUndefined();
    expect(read.candidates).toHaveLength(1);
  });
});

describe('YaleCollegeFellowshipsOfficeScraper eligibility, year of study and fund routes (#4233)', () => {
  const macmillanPageUrl = 'https://macmillan.yale.edu/fellowships-and-grants';
  const referenceDate = new Date('2026-08-22T00:00:00.000Z');

  const opportunityRow = (href: string, title: string, summary: string) => `
    <article class="node-teaser node-teaser--opportunity node-teaser--text">
      <header class="node-teaser__header">
        <div class="node-teaser__groups">MacMillan Center</div>
        <div class="node-teaser__heading"><a href="${href}"><span>${title}</span></a></div>
      </header>
      <div class="node-teaser__content">
        <div class="node-teaser__summary"><div class="ck-content"><p>${summary}</p></div></div>
      </div>
    </article>`;

  it('reads a short-link heading on an opportunity row as the fund route, and a page link as none', () => {
    const html = `<main>
      ${opportunityRow(
        'https://bit.ly/fixtureA',
        'Fixture Travel Prize',
        'Grants will be awarded to current juniors in Yale College for summer travel.',
      )}
      ${opportunityRow(
        'https://macmillan.yale.edu/fixture-council/fixture-language-grant',
        'Fixture Language Grant',
        'Supports summer language study abroad.',
      )}
    </main>`;
    const candidates = parseFellowshipCatalogPage(html, macmillanPageUrl, referenceDate);
    const prize = candidates.find((candidate) => candidate.title === 'Fixture Travel Prize');
    const grant = candidates.find((candidate) => candidate.title === 'Fixture Language Grant');

    expect(prize?.applicationLink).toBe('https://bit.ly/fixtureA');
    expect(prize?.eligibility).toBe(
      'Grants will be awarded to current juniors in Yale College for summer travel.',
    );
    expect(prize?.yearOfStudy).toEqual(['Junior']);
    expect(grant?.applicationLink).toBeUndefined();
    expect(grant?.eligibility).toBeUndefined();
    expect(grant?.yearOfStudy).toEqual([]);
  });

  const detailHtml = (body: string) => `
    <main>
      <h1>Fixture Summer Research Fellowship</h1>
      <div class="field--name-body">${body}</div>
    </main>`;

  it('repairs a doubled scheme and is not blocked by an unhelpful link that labels itself an application', () => {
    const [candidate] = parseFellowshipCatalogPage(
      detailHtml(`
        <p>The fellowship funds original summer research.</p>
        <p><a href="https://science.yalecollege.yale.edu/">Application information</a></p>
        <p>Apply in the <a href="http://https://bit.ly/fixtureB">Yale Student Grants &amp; Fellowships database</a>.</p>
      `),
      detailPageUrl,
      referenceDate,
    );

    expect(candidate.applicationLink).toBe('https://bit.ly/fixtureB');
  });

  it('reads the eligibility statement and the years it admits from a detail page', () => {
    const [candidate] = parseFellowshipCatalogPage(
      detailHtml(`
        <p>Stipend support is granted for ten weeks of full-time summer research.</p>
        <h2>Eligibility</h2>
        <p>Currently enrolled first-years proposing research in the sciences are eligible to apply.</p>
        <p>In order to be eligible, Yale College students must be enrolled at the time of the award.</p>
        <p>Eligible students with questions should email fixture.office@example.edu.</p>
        <p>Associate Dean for Graduate Student Engagement</p>
      `),
      detailPageUrl,
      referenceDate,
    );

    expect(candidate.eligibility).toBe(
      'Currently enrolled first-years proposing research in the sciences are eligible to apply. In order to be eligible, Yale College students must be enrolled at the time of the award.',
    );
    expect(candidate.yearOfStudy).toEqual(['First-Year Student']);
    const observations = candidateToObservations(candidate);
    expect(observations.find((obs) => obs.field === 'eligibility')?.value).toBe(
      candidate.eligibility,
    );
    expect(observations.find((obs) => obs.field === 'yearOfStudy')?.value).toEqual([
      'First-Year Student',
    ]);
  });

  it('never keeps an eligibility sentence whose contact link is labelled with a name', () => {
    const [candidate] = parseFellowshipCatalogPage(
      detailHtml(`
        <p>Juniors are eligible to apply.</p>
        <p>Eligible students are advised by <a href="mailto:fixture.adviser@example.edu">Fixture Adviser</a>.</p>
      `),
      detailPageUrl,
      referenceDate,
    );

    expect(candidate.eligibility).toBe('Juniors are eligible to apply.');
  });

  it('emits no eligibility or year of study when the page states neither', () => {
    const [candidate] = parseFellowshipCatalogPage(
      detailHtml('<p>The fellowship funds original summer research in the sciences.</p>'),
      detailPageUrl,
      referenceDate,
    );

    expect(candidate.eligibility).toBeUndefined();
    expect(candidate.yearOfStudy).toEqual([]);
    const fields = candidateToObservations(candidate).map((obs) => obs.field);
    expect(fields).not.toContain('eligibility');
    expect(fields).not.toContain('yearOfStudy');
  });

  it('reads research and study only where the award funds them', () => {
    expect(inferPurpose('Fixture Graduate Research Fellowships for the summer.')).toEqual([
      'Research',
    ]);
    expect(inferPurpose('Funding for students engaged in dissertation research.')).toEqual([
      'Research',
    ]);
    expect(
      inferPurpose(
        'Applicants should have laid a foundation through their coursework. The program covers room and board, as well as the course tuition.',
      ),
    ).toEqual([]);
    expect(inferPurpose('Application Year: Junior Senior Can Support Graduate Study:')).toEqual([]);
    expect(inferPurpose('Supports one or two years of undergraduate study.')).toEqual(['Study']);
    expect(
      inferPurpose('The fellowship supports students in any field of study conducting research.'),
    ).toEqual(['Research']);
    expect(inferPurpose('The program funds research but not study.')).not.toContain('Study');
    expect(inferPurpose('Awards help defray travel costs for conference trips.')).toEqual([
      'Travel',
    ]);
  });
});

describe('YaleCollegeFellowshipsOfficeScraper short links (#4289)', () => {
  const catalogUrl = 'https://macmillan.yale.edu/fellowships-and-grants';
  const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?46495854555245';
  const opportunityRow = (title: string, href: string) => `
    <div class="view__row">
      <article class="node-teaser node-teaser--opportunity node-teaser--text">
        <header class="node-teaser__header">
          <div class="node-teaser__groups">Fixture Council</div>
          <div class="node-teaser__heading"><a href="${href}"><span>${title}</span></a></div>
        </header>
        <div class="node-teaser__content">
          <div class="node-teaser__summary">
            <div class="ck-content"><p>Supports summer research travel for undergraduates.</p></div>
          </div>
        </div>
      </article>
    </div>`;
  const catalogHtml = (...rows: string[]) =>
    `<main><div class="view__rows">${rows.join('')}</div></main>`;

  const runLane = async (
    html: string,
    deps: Partial<ConstructorParameters<typeof YaleCollegeFellowshipsOfficeScraper>[0]> = {},
  ) => {
    const emitted: any[] = [];
    const log = vi.fn();
    const result = await new YaleCollegeFellowshipsOfficeScraper({
      pageUrls: [catalogUrl],
      sitemapUrls: [],
      fetchPage: async () => html,
      shortLinkDelayMs: 0,
      ...deps,
    }).run({
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'yale-college-fellowships-office',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (items) => {
        emitted.push(...(Array.isArray(items) ? items : [items]));
      },
      log,
    });
    const valueFor = (title: string, field: string) => {
      const entityKey = sourceKeyForTitle(title);
      return emitted.find(
        (observation) => observation.entityKey === entityKey && observation.field === field,
      )?.value;
    };
    return { result, log, valueFor };
  };

  it('cites the fund page a short link redirects to, reading each short link once', async () => {
    const hop = vi.fn(async () => FUND_PAGE);
    const { valueFor, result } = await runLane(
      catalogHtml(
        opportunityRow('Fixture Travel Prize', 'https://bit.ly/fixture-fund'),
        opportunityRow('Fixture Travel Prize for Seniors', 'https://bit.ly/fixture-fund'),
      ),
      { shortLinkHop: hop },
    );

    expect(hop).toHaveBeenCalledTimes(1);
    expect(hop).toHaveBeenCalledWith('https://bit.ly/fixture-fund');
    expect(valueFor('Fixture Travel Prize', 'applicationLink')).toBe(FUND_PAGE);
    expect(valueFor('Fixture Travel Prize', 'links')).toEqual([
      { label: 'Application', url: FUND_PAGE },
    ]);
    expect(valueFor('Fixture Travel Prize for Seniors', 'applicationLink')).toBe(FUND_PAGE);
    expect(result.metrics?.fellowshipCatalog?.shortLinks).toMatchObject({
      lookedUp: 1,
      citedAsFundPage: 1,
    });
  });

  it('keeps a short link whose target is not a record-specific fund page', async () => {
    const hop = vi.fn(async () => 'https://yale.communityforce.com/Funds/Search.aspx');
    const { valueFor } = await runLane(
      catalogHtml(opportunityRow('Fixture Travel Prize', 'https://bit.ly/fixture-search')),
      { shortLinkHop: hop },
    );

    expect(hop).toHaveBeenCalledTimes(1);
    expect(valueFor('Fixture Travel Prize', 'applicationLink')).toBe(
      'https://bit.ly/fixture-search',
    );
    expect(valueFor('Fixture Travel Prize', 'links')).toEqual([
      { label: 'Application', url: 'https://bit.ly/fixture-search' },
    ]);
  });

  it('never follows a link that is not a short link', async () => {
    const hop = vi.fn(async () => FUND_PAGE);
    const ownFundPage = 'https://yale.communityforce.com/Funds/FundDetails.aspx?4F574E';
    const { valueFor } = await runLane(
      catalogHtml(opportunityRow('Fixture Travel Prize', ownFundPage)),
      { shortLinkHop: hop },
    );

    expect(hop).not.toHaveBeenCalled();
    expect(valueFor('Fixture Travel Prize', 'applicationLink')).toBe(ownFundPage);
  });

  it('keeps the short link and finishes the run when the redirect cannot be read', async () => {
    const hop = vi.fn(async () => {
      throw new Error('connect ETIMEDOUT');
    });
    const { valueFor, log, result } = await runLane(
      catalogHtml(opportunityRow('Fixture Travel Prize', 'https://bit.ly/fixture-down')),
      { shortLinkHop: hop },
    );

    expect(valueFor('Fixture Travel Prize', 'applicationLink')).toBe('https://bit.ly/fixture-down');
    expect(log).toHaveBeenCalledWith(
      'Keeping fellowship short link after its redirect could not be read',
      expect.objectContaining({ url: 'https://bit.ly/fixture-down' }),
    );
    expect(result.notes).toContain('Kept 1 fellowship short link(s) whose target was not read.');
    expect(result.metrics?.fellowshipCatalog?.shortLinks).toMatchObject({ failed: 1 });
  });

  it('reads no redirect under a benchmark replay, so the frozen input still replays', async () => {
    const hop = vi.fn(async () => FUND_PAGE);
    const emitted: any[] = [];
    beginBenchmarkReplay([
      {
        sourceName: 'yale-college-fellowships-office',
        requestKey: `page:${catalogUrl}`,
        payload: catalogHtml(opportunityRow('Fixture Travel Prize', 'https://bit.ly/fixture-fund')),
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    let replay;
    try {
      await new YaleCollegeFellowshipsOfficeScraper({
        pageUrls: [catalogUrl],
        sitemapUrls: [],
        shortLinkHop: hop,
      }).run({
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-college-fellowships-office',
        sourceWeight: 0.95,
        options: { dryRun: true, useCache: true, release: false },
        emit: async (items) => {
          emitted.push(...(Array.isArray(items) ? items : [items]));
        },
        log: vi.fn(),
      });
    } finally {
      replay = finishBenchmarkReplay();
    }

    expect(hop).not.toHaveBeenCalled();
    expect(replay.networkBlocks).toBe(0);
    expect(emitted.find((observation) => observation.field === 'applicationLink')?.value).toBe(
      'https://bit.ly/fixture-fund',
    );
  });

  it('paces lookups and stops reading redirects at its bound', async () => {
    const sleep = vi.fn(async () => undefined);
    const hop = vi.fn(async (shortLink: string) => `${FUND_PAGE}${shortLink.slice(-1)}`);
    const resolver = createFundShortLinkResolver({ hop, sleep, delayMs: 300, maxLookups: 2 });

    expect(await resolver.fundPageFor('https://bit.ly/a')).toBe(`${FUND_PAGE}a`);
    expect(await resolver.fundPageFor('https://bit.ly/b')).toBe(`${FUND_PAGE}b`);
    expect(await resolver.fundPageFor('https://bit.ly/c')).toBe('');
    expect(await resolver.fundPageFor('https://bit.ly/a')).toBe(`${FUND_PAGE}a`);
    expect(hop).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(300);
    expect(resolver.metrics).toMatchObject({ lookedUp: 2, citedAsFundPage: 2, capped: 1 });
  });
});

describe('what a program page says about having a deadline (#4230)', () => {
  const detailPage = (body: string) =>
    parseFellowshipCatalogPage(
      `<main><h1>Fixture Research Fellowship</h1><div class="text">${body}</div></main>`,
      detailPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    )[0];

  const claimOf = (candidate: Parameters<typeof candidateToObservations>[0]) =>
    candidateToObservations(candidate).find((obs) => obs.field === 'sourceKey')
      ?.assertsNoValueFor ?? [];

  it('states no deadline when review is rolling and the only date is encouraged', () => {
    const candidate = detailPage(
      '<p>Is there a deadline for applications? While we review applications as we receive them, we encourage you to submit your application by December 15th.</p>',
    );

    expect(candidate.deadlineStatement).toBe('none');
    expect(candidate.deadline).toBeUndefined();
    expect(claimOf(candidate)).toEqual(['deadline']);
  });

  it('states no deadline when the page says there is no fixed one', () => {
    const candidate = detailPage(
      '<p>The fellowship funds summer research. There is no fixed deadline, and applications are accepted year-round.</p>',
    );

    expect(candidate.deadlineStatement).toBe('none');
    expect(claimOf(candidate)).toEqual(['deadline']);
  });

  it('states a deadline it cannot read rather than an absence, recommendation letters and all', () => {
    const candidate = detailPage(
      '<p>The entire application package, including two letters of recommendation and official transcripts, must be received by February 01.</p>',
    );

    expect(candidate.deadlineStatement).toBe('stated');
    expect(candidate.deadline).toBeUndefined();
    expect(claimOf(candidate)).toEqual([]);
  });

  it('says nothing when the date a requirement names is one it cannot recognize', () => {
    const candidate = detailPage(
      '<p>Applications must be received by the first Monday of February.</p>',
    );

    expect(candidate.deadlineStatement).toBe('unresolved');
    expect(claimOf(candidate)).toEqual([]);
  });

  it('says nothing about a deadline on a page that says nothing about applying', () => {
    const candidate = detailPage(
      '<p>The fellowship funds summer research with a faculty mentor in the sciences.</p>',
    );

    expect(candidate.deadlineStatement).toBe('unresolved');
    expect(claimOf(candidate)).toEqual([]);
  });

  it('reads the deadline the page states and claims nothing', () => {
    const candidate = detailPage(
      '<p>The fellowship funds summer research. Application deadline: February 20, 2026.</p>',
    );

    expect(candidate.deadlineStatement).toBe('stated');
    expect(candidate.deadline).toEqual(parseProgramDate('February 20, 2026', 'deadline'));
    expect(claimOf(candidate)).toEqual([]);
  });

  it('says nothing from a catalog row, which never read the program page', () => {
    const [candidate] = parseFellowshipCatalogPage(
      `
        <main>
          <ul>
            <li><a href="${detailPageUrl}">Fixture Research Fellowship</a> Applications are reviewed on a rolling basis.</li>
          </ul>
        </main>
      `,
      fundingPageUrl,
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidate.deadlineStatement).toBe('unresolved');
    expect(claimOf(candidate)).toEqual([]);
  });

  it('claims nothing for a page the lane refused as not a program', () => {
    const read = readFellowshipCatalogPage(
      `
        <main>
          <h1>Fellowships and Funding</h1>
          <p>Applications are reviewed as we receive them.</p>
          <ul>
            <li><a href="https://funding.yale.edu/a">First Research Fellowship</a></li>
            <li><a href="https://funding.yale.edu/b">Second Research Fellowship</a></li>
            <li><a href="https://funding.yale.edu/c">Third Research Fellowship</a></li>
          </ul>
        </main>
      `,
      'https://funding.yale.edu/fellowships-and-funding',
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(read.candidates.flatMap((candidate) => claimOf(candidate))).toEqual([]);
  });
});

describe('the deadline a page with several cycles is planned at (#4227)', () => {
  const autumn = new Date('2026-10-01T12:00:00Z');
  const detailPage = (body: string, referenceDate: Date = autumn) =>
    parseFellowshipCatalogPage(
      `<main><h1>Fixture Research Fellowship</h1><div class="text">${body}</div></main>`,
      detailPageUrl,
      referenceDate,
    )[0];
  const endOfNewYorkDay = (date: string, referenceDate: Date = autumn) =>
    parseProgramDate(date, 'deadline', referenceDate);

  const twoTerms =
    '<p>The fall term deadline is Thursday, July 30, 2026, and the spring term deadline is Monday, January 4, 2027.</p>';

  it('plans the next cycle over one that has passed, so the program reads as open', () => {
    const candidate = detailPage(twoTerms);

    expect(candidate.deadline).toEqual(endOfNewYorkDay('January 4, 2027'));
    expect(candidate.isAcceptingApplications).toBe(true);
  });

  it('plans the earliest of several upcoming deadlines, not the first one stated', () => {
    const candidate = detailPage(
      '<p>The summer deadline is March 3, 2027.</p><p>The spring deadline is January 10, 2027.</p>',
    );

    expect(candidate.deadline).toEqual(endOfNewYorkDay('January 10, 2027'));
  });

  it('plans the latest deadline once every stated one has passed', () => {
    const lateSpring = new Date('2027-06-01T12:00:00Z');
    const candidate = detailPage(twoTerms, lateSpring);

    expect(candidate.deadline).toEqual(endOfNewYorkDay('January 4, 2027', lateSpring));
    expect(candidate.isAcceptingApplications).toBe(false);
  });

  it('plans a single stated deadline as before', () => {
    const candidate = detailPage('<p>Application deadline: February 20, 2027.</p>');

    expect(candidate.deadline).toEqual(endOfNewYorkDay('February 20, 2027'));
  });

  it('keeps the stated time of the cycle it plans', () => {
    const candidate = detailPage(
      '<p>Fall deadline: September 15, 2026 at 5:00pm ET. Spring deadline: February 1, 2027 at 11:00 pm ET.</p>',
    );

    expect(candidate.deadline?.toISOString()).toBe('2027-02-02T04:00:00.000Z');
  });

  it('never plans a date that belongs to another step beside the deadline', () => {
    const lateWinter = new Date('2026-03-01T12:00:00Z');
    const candidate = detailPage(
      '<p>Application deadline: February 20, 2026. Letters of recommendation are due by March 15, 2026. Information session: March 4, 2026. Decisions will be announced by April 1, 2026.</p>',
      lateWinter,
    );

    expect(candidate.deadline).toEqual(endOfNewYorkDay('February 20, 2026', lateWinter));
  });

  it('reads no deadline from a notification date that follows an undated one', () => {
    const candidate = detailPage(
      '<p>Application deadline March 2026 Notifications sent May 26, 2026 Program start date July 24, 2026</p>',
    );

    expect(candidate.deadline).toBeUndefined();
  });

  it('lets a later label choose a cycle but never find a deadline the first label did not', () => {
    const candidate = detailPage(
      '<p>Campus application deadline typically in November.</p><p>Application or Website Link: https://apply.example.org/funds/fixture-fund-record-with-a-long-path-segment-0001</p><p>Application Open/Deadline: Friday, June 21, 2019 to Friday, November 15, 2019</p>',
    );

    expect(candidate.deadline).toBeUndefined();
  });

  it('counts a later label only with a date in its own sentence', () => {
    const candidate = detailPage(
      '<p>The application deadline is January 15, 2027.</p><p>Spring deadline to be announced.</p><p>Program dates: November 1, 2026.</p>',
    );

    expect(candidate.deadline).toEqual(endOfNewYorkDay('January 15, 2027'));
  });

  it('still claims the deadline absent on a rolling page that encourages two dates', () => {
    const candidate = detailPage(
      '<p>We review applications as we receive them, and we encourage you to apply by December 15, 2026 for spring or by April 15, 2027 for summer.</p>',
    );

    expect(candidate.deadlineStatement).toBe('none');
    expect(candidate.deadline).toBeUndefined();
    expect(
      candidateToObservations(candidate).find((obs) => obs.field === 'sourceKey')
        ?.assertsNoValueFor,
    ).toEqual(['deadline']);
  });

  it('chooses the cycle against the pinned reference date of the run', async () => {
    const programUrl =
      'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/fixture-cycle-fellowship';
    const html = `<main><h1>Fixture Cycle Research Fellowship</h1><p>Supports an independent research project.</p>${twoTerms}</main>`;
    const plannedDeadline = async (referenceDate: Date) => {
      const emitted: any[] = [];
      await new YaleCollegeFellowshipsOfficeScraper({
        pageUrls: [programUrl],
        fetchPage: vi.fn(async () => html),
      }).run({
        scrapeRunId: 'run-1',
        sourceId: 'source-1',
        sourceName: 'yale-college-fellowships-office',
        sourceWeight: 0.95,
        options: { dryRun: true, useCache: false, release: false, referenceDate },
        emit: async (items) => {
          emitted.push(...(Array.isArray(items) ? items : [items]));
        },
        log: vi.fn(),
      });
      const deadline = emitted.find((observation) => observation.field === 'deadline')?.value;
      return deadline ? new Date(deadline).toISOString() : undefined;
    };

    const midsummer = new Date('2026-07-01T12:00:00Z');
    expect(await plannedDeadline(midsummer)).toBe(
      endOfNewYorkDay('July 30, 2026', midsummer)?.toISOString(),
    );
    expect(await plannedDeadline(autumn)).toBe(endOfNewYorkDay('January 4, 2027')?.toISOString());
  });
});

describe('the structured record an external-award page carries (#4363)', () => {
  const externalAwardUrl = 'https://funding.yale.edu/external-award/fixture-summer-research';

  const field = (name: string, label: string, items: string) =>
    `<div class="field field-name-field-${name} field-type-text field-label-above"><div class="field-label">${label}:&nbsp;</div><div class="field-items">${items}</div></div>`;

  const externalAward = ({
    description = 'Offers funded summer laboratory research experience at host institutions across the country.',
    website = '<div class="field-item even"><a href="http://www.fixture-research-program.org/apply">http://www.fixture-research-program.org/apply</a></div>',
    window = '<div class="field-item even"><span class="date-display-range"><span class="date-display-start" content="2019-06-21T00:00:00-04:00">Friday, June 21, 2019</span> to <span class="date-display-end" content="2020-02-10T00:00:00-05:00">Monday, February 10, 2020</span></span></div>',
    years = '<div class="field-item even">Sophomore</div><div class="field-item odd">Junior</div><div class="field-item even">Senior</div>',
  } = {}) =>
    parseFellowshipCatalogPage(
      `<h1>Fixture Summer Research Program</h1>
        <div class="node node-external-award">
          ${field('description', 'Description', `<div class="field-item even"><p>${description}</p></div>`)}
          ${field('application-website-lin', 'Application or Website Link', website)}
          ${field('adviser', 'Adviser', '<div class="field-item even">Any Adviser</div>')}
          ${field('application-deadline', 'Application Open/Deadline', window)}
          ${field('citizenship', 'Citizenship', '<div class="field-item even">US Citizen</div>')}
          ${field('application-year', 'Application Year', years)}
        </div>`,
      externalAwardUrl,
      new Date('2026-10-02T12:00:00Z'),
    )[0];

  const claimOf = (candidate: Parameters<typeof candidateToObservations>[0]) =>
    candidateToObservations(candidate).find((obs) => obs.field === 'sourceKey')
      ?.assertsNoValueFor ?? [];

  it('keeps the application or website link on the outside program host as the route', () => {
    const candidate = externalAward();

    expect(candidate.links).toContainEqual({
      label: 'Application or program website',
      url: 'http://www.fixture-research-program.org/apply',
    });
    expect(candidate.applicationLink).toBe('http://www.fixture-research-program.org/apply');
  });

  it('unwraps a mail-gateway link to the program page it wraps', () => {
    const wrapped = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(
      'https://www.fixture-research-program.org/fellowship.html',
    )}&amp;data=05%7C01&amp;reserved=0`;
    const candidate = externalAward({
      website: `<div class="field-item even"><a href="${wrapped}">link</a></div>`,
    });

    expect(candidate.applicationLink).toBe(
      'https://www.fixture-research-program.org/fellowship.html',
    );
  });

  it('plans the closing date of the window as the deadline and its first date as the opening', () => {
    const candidate = externalAward();

    expect(candidate.deadline?.toISOString()).toBe(
      parseProgramDate('February 10, 2020', 'deadline')?.toISOString(),
    );
    expect(candidate.applicationOpenDate?.toISOString()).toBe(
      parseProgramDate('June 21, 2019', 'opens')?.toISOString(),
    );
  });

  it('reads a window written as plain text the same way', () => {
    const candidate = externalAward({
      window:
        '<div class="field-item">Thursday, September 1, 2022 to Tuesday, October 18, 2022</div>',
    });

    expect(candidate.deadline?.toISOString()).toBe(
      parseProgramDate('October 18, 2022', 'deadline')?.toISOString(),
    );
  });

  const singleDateWindow =
    '<div class="field-item even"><span class="date-display-single" content="2019-06-21T00:00:00-04:00">Friday, June 21, 2019</span></div>';

  it('reads no date from a window with one date, which does not say whether it opens or closes', () => {
    const candidate = externalAward({ window: singleDateWindow });

    expect(candidate.deadline).toBeUndefined();
    expect(candidate.applicationOpenDate).toBeUndefined();
    expect(claimOf(candidate)).not.toContain('deadline');
  });

  it('lets the prose state the deadline when the window has one date', () => {
    const candidate = externalAward({
      window: singleDateWindow,
      description: 'The application deadline is March 1, 2027 for the summer research cohort.',
    });

    expect(candidate.deadline?.toISOString()).toBe(
      parseProgramDate('March 1, 2027', 'deadline')?.toISOString(),
    );
  });

  it('answers the year of study from the listed years when the prose names none', () => {
    expect(externalAward().yearOfStudy).toEqual(['Sophomore', 'Junior', 'Senior']);
  });

  it('reads no year from a list carrying the graduate option, which says nothing mappable', () => {
    const candidate = externalAward({
      years:
        '<div class="field-item even">Senior</div><div class="field-item odd">Graduate Student and Alumni</div>',
    });

    expect(candidate.yearOfStudy).toEqual([]);
  });

  it('lets prose that names years decide over the list', () => {
    const candidate = externalAward({
      description: 'Eligible are juniors in the natural sciences who plan a research career.',
    });

    expect(candidate.yearOfStudy).toEqual(['Junior']);
  });

  it('emits no year of study when the list carries an option the vocabulary cannot name', () => {
    const candidate = externalAward({
      years:
        '<div class="field-item even">Sophomore</div><div class="field-item odd">Postdoc</div>',
    });

    expect(candidate.yearOfStudy).toEqual([]);
  });

  it('drops a website link whose page is gone and falls back to the next route', async () => {
    const candidate = externalAward({
      website:
        '<div class="field-item even"><a href="https://www.fixture-research-program.org/moved">old</a></div>',
    });
    const checker = createRecordWebsiteLinkChecker({
      probe: async () => 404,
      sleep: async () => undefined,
    });

    const checked = await withoutGoneRecordWebsiteLinks(candidate, checker);

    expect(checked.links).toEqual([]);
    expect(checked.applicationLink).toBeUndefined();
    expect(checker.metrics).toEqual({ probed: 1, dead: 1, failed: 0, capped: 0 });
  });

  it('keeps a website link behind a bot challenge or a failed request', async () => {
    const candidate = externalAward();
    const challenged = createRecordWebsiteLinkChecker({
      probe: async () => 403,
      sleep: async () => undefined,
    });
    const failing = createRecordWebsiteLinkChecker({
      probe: async () => {
        throw new Error('timeout');
      },
      sleep: async () => undefined,
    });

    expect((await withoutGoneRecordWebsiteLinks(candidate, challenged)).applicationLink).toBe(
      candidate.applicationLink,
    );
    expect((await withoutGoneRecordWebsiteLinks(candidate, failing)).applicationLink).toBe(
      candidate.applicationLink,
    );
    expect(failing.metrics.failed).toBe(1);
  });

  it('never probes a link the page did not carry in its record field', async () => {
    const probe = vi.fn(async () => 404);
    const checker = createRecordWebsiteLinkChecker({ probe, sleep: async () => undefined });
    const candidate = externalAward({ website: '' });

    await withoutGoneRecordWebsiteLinks(candidate, checker);

    expect(probe).not.toHaveBeenCalled();
  });
});
