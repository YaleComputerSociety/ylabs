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

  it('parses Month Day Year deadlines as UTC end-of-day and ignores fuzzy dates', () => {
    expect(parseDeadlineToUtcEndOfDay('Deadline: Monday, January 5, 2026 at 11:00pm ET')).toEqual(
      new Date('2026-01-05T23:59:59.999Z'),
    );
    expect(
      parseDeadlineToUtcEndOfDay('Application deadline typically in February/March.'),
    ).toBeUndefined();
    expect(parseDeadlineToUtcEndOfDay('Deadline: February 30, 2026')).toBeUndefined();
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
