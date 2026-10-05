import { describe, expect, it, vi } from 'vitest';
import {
  chooseOfficialPage,
  officialPageNamesFund,
  officialPageText,
} from '../utils/programOfficialPage';
import {
  ProgramOfficialPageScraper,
  type ProgramOfficialPageCandidate,
} from '../sources/programOfficialPageScraper';
import { LANE_PAGE_HEALTH_FIELD } from '../lanePageHealth';
import type { ObservationInput, ScraperContext } from '../types';

const named = (title: string, text: string, host = '') =>
  officialPageNamesFund(title, text, host).named;

describe('officialPageNamesFund', () => {
  it('cites a page that states the fund title', () => {
    expect(
      named(
        'Fixture Q. Sample Travel Fellowship',
        'Apply for the Fixture Q. Sample Travel Fellowship.',
      ),
    ).toBe(true);
  });

  it('reads a college-prefixed title by the fund name the college page uses', () => {
    expect(
      named(
        'Elmhurst College Quillon Summer Fellowship',
        'A Quillon Summer Fellowship is awarded for independent research.',
        'elmhurst.yale.edu',
      ),
    ).toBe(true);
    expect(
      named(
        'Elmhurst Quillon Summer Fellowship',
        'The Quillon fellowship supports summer research.',
        'elmhurst.yale.edu',
      ),
    ).toBe(true);
  });

  it('refuses a different fund that shares the name inside a longer proper name', () => {
    expect(
      named(
        'Elmhurst College Quillon Senior Research Grant',
        'The Marten Quillon Fellowship is offered to two seniors for study abroad.',
        'elmhurst.yale.edu',
      ),
    ).toBe(false);
  });

  it('refuses a single-word fund name followed by a different kind of award and no qualifier', () => {
    expect(
      named(
        'Elmhurst College Quillon Senior Research Grant',
        'The Quillon Fellowship pays tuition at a partner college.',
        'elmhurst.yale.edu',
      ),
    ).toBe(false);
    expect(
      named(
        'Elmhurst College Quillon Senior Research Grant',
        'Quillon research awards support senior essays.',
        'elmhurst.yale.edu',
      ),
    ).toBe(true);
  });

  it('refuses a page that names only the program that offers the award', () => {
    expect(
      named(
        'Fixture Program on Sample Studies Travel and Research Award',
        'The Fixture Program on Sample Studies convenes faculty and students.',
      ),
    ).toBe(false);
  });

  it('refuses a page that names the fund name with other words between it and the award', () => {
    expect(
      named(
        'Quillon Senior Research Grant',
        'The Quillon Marten undergraduate fellowship program.',
      ),
    ).toBe(false);
  });

  it('refuses a page that never names the fund', () => {
    expect(named('Fixture Sample Travel Fellowship', 'Funding opportunities for students.')).toBe(
      false,
    );
  });

  it('reads page text without scripts and styles', () => {
    const text = officialPageText(
      '<html><head><title>Awards</title><script>var x = "Fixture Sample Fellowship";</script></head><body><p>Grants</p></body></html>',
    );
    expect(text).toContain('Grants');
    expect(text).not.toContain('Fixture Sample Fellowship');
  });
});

describe('chooseOfficialPage', () => {
  it('prefers the stored official page, then the lane’s own citation, then the seed, never the fund page', () => {
    const fundPage = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTURE';
    expect(
      chooseOfficialPage({
        storedSourceUrl: 'https://a.yale.edu/x',
        ownCitedUrl: 'https://b.yale.edu/y',
        seedUrl: 'https://c.yale.edu/z',
      }),
    ).toBe('https://a.yale.edu/x');
    expect(
      chooseOfficialPage({
        storedSourceUrl: fundPage,
        ownCitedUrl: '',
        seedUrl: 'https://c.yale.edu/z',
      }),
    ).toBe('https://c.yale.edu/z');
    expect(chooseOfficialPage({ storedSourceUrl: fundPage })).toBeNull();
  });
});

function context(emitted: ObservationInput[]): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'program-official-page',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (observations) => {
      emitted.push(...(Array.isArray(observations) ? observations : [observations]));
    },
    log: () => undefined,
  };
}

const candidate = (overrides: Partial<ProgramOfficialPageCandidate> = {}) => ({
  recordId: 'fixture-id',
  sourceKey: 'student-grants-database:fixture-fund',
  title: 'Fixture Sample Travel Fellowship',
  pageUrl: 'https://fixture.yale.edu/fellowships',
  ...overrides,
});

describe('ProgramOfficialPageScraper', () => {
  it('cites a page that names the fund, with a live read verdict on the same page', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new ProgramOfficialPageScraper(
      async () => [candidate()],
      async (url) => ({ html: '<p>The Fixture Sample Travel Fellowship</p>', finalUrl: url }),
    );

    await scraper.run(context(emitted));

    expect(emitted.find((o) => o.field === 'sourceUrl')).toMatchObject({
      entityType: 'fellowship',
      entityKey: 'student-grants-database:fixture-fund',
      value: 'https://fixture.yale.edu/fellowships',
      sourceUrl: 'https://fixture.yale.edu/fellowships',
    });
    expect(emitted.find((o) => o.field === LANE_PAGE_HEALTH_FIELD)?.value).toMatchObject({
      healthStatus: 'HEALTHY',
    });
  });

  it('records a withdrawal when the page it read does not name the fund', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new ProgramOfficialPageScraper(
      async () => [candidate()],
      async (url) => ({ html: '<p>Other awards</p>', finalUrl: url }),
    );

    await scraper.run(context(emitted));

    expect(emitted.find((o) => o.field === 'sourceUrl')).toMatchObject({ value: '' });
  });

  it('records a gone verdict only when a confirming probe agrees the page is gone', async () => {
    const goneEmitted: ObservationInput[] = [];
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      status: 404,
    });
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 });
    await new ProgramOfficialPageScraper(
      async () => [candidate()],
      async () => {
        throw notFound;
      },
      probe,
    ).run(context(goneEmitted));

    expect(goneEmitted).toHaveLength(1);
    expect(goneEmitted[0]).toMatchObject({
      field: LANE_PAGE_HEALTH_FIELD,
      value: { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
    });

    const blockedEmitted: ObservationInput[] = [];
    const blocked = Object.assign(new Error('Request failed with status code 403'), {
      status: 403,
    });
    await new ProgramOfficialPageScraper(
      async () => [candidate()],
      async () => {
        throw blocked;
      },
      probe,
    ).run(context(blockedEmitted));

    expect(blockedEmitted).toHaveLength(0);
  });

  it('reads a page shared by several programs once', async () => {
    const fetchPage = vi.fn(async (url: string) => ({
      html: '<p>The Fixture Sample Travel Fellowship and the Fixture Other Grant</p>',
      finalUrl: url,
    }));
    const emitted: ObservationInput[] = [];
    await new ProgramOfficialPageScraper(
      async () => [
        candidate(),
        candidate({
          recordId: 'fixture-id-2',
          sourceKey: 'student-grants-database:fixture-other',
          title: 'Fixture Other Grant',
        }),
      ],
      fetchPage,
    ).run(context(emitted));

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(emitted.filter((o) => o.field === 'sourceUrl').map((o) => o.value)).toEqual([
      'https://fixture.yale.edu/fellowships',
      'https://fixture.yale.edu/fellowships',
    ]);
  });
});
