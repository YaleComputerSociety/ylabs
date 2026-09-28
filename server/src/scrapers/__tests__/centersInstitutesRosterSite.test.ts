import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  CentersInstitutesScraper,
  DEFAULT_CENTER_CONFIGS,
  centerRosterPageSiteRefusal,
  centerRosterSiteRefusal,
  nodeTeaserPersonExtractor,
  type CenterConfig,
  type ExtractorResult,
} from '../sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../types';

const baseConfig: CenterConfig = {
  centerKey: 'alpha-center',
  centerName: 'Alpha Center for Synthetic Studies',
  schoolName: '',
  kind: 'center',
  url: 'https://alpha.example.edu/people',
  homeUrl: 'https://alpha.example.edu/',
  extractor: () => ({ members: [] }),
};

function withConfig(overrides: Partial<CenterConfig>): CenterConfig {
  return { ...baseConfig, ...overrides };
}

function makeContext() {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'centers-institutes-index',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: (message: string) => {
      logs.push(message);
    },
  };
  return { ctx, emitted, logs };
}

describe('centerRosterSiteRefusal', () => {
  it('accepts a roster on the host of the declared home page', () => {
    expect(centerRosterSiteRefusal(baseConfig)).toBeNull();
  });

  it('refuses a roster published on another organization host', () => {
    expect(
      centerRosterSiteRefusal(withConfig({ url: 'https://beta.example.edu/people/faculty' })),
    ).toBe('roster-off-center-host');
  });

  it('refuses a config that declares no home page, since nothing can vouch for the roster', () => {
    expect(centerRosterSiteRefusal(withConfig({ homeUrl: undefined }))).toBe('no-declared-home');
  });

  it('refuses a roster under a sibling unit on a shared host', () => {
    const unit = withConfig({ homeUrl: 'https://shared.example.edu/unit-a' });
    expect(
      centerRosterSiteRefusal({ ...unit, url: 'https://shared.example.edu/unit-b/people' }),
    ).toBe('roster-outside-center-path');
    expect(
      centerRosterSiteRefusal({ ...unit, url: 'https://shared.example.edu/unit-ab/people' }),
    ).toBe('roster-outside-center-path');
    expect(
      centerRosterSiteRefusal({ ...unit, url: 'https://shared.example.edu/unit-a/people' }),
    ).toBeNull();
  });

  it('treats www and letter case as the same site', () => {
    expect(
      centerRosterSiteRefusal(
        withConfig({
          homeUrl: 'https://www.Alpha.example.edu/Unit/',
          url: 'https://alpha.example.edu/unit/people',
        }),
      ),
    ).toBeNull();
  });

  it('accepts a declared shared roster site only when it carries a reason', () => {
    const shared = withConfig({
      url: 'https://partner.example.edu/joint/people',
      sharedRosterSite: {
        url: 'https://partner.example.edu/joint',
        reason: 'The partner site publishes the joint roster for both units.',
      },
    });
    expect(centerRosterSiteRefusal(shared)).toBeNull();
    expect(
      centerRosterSiteRefusal({
        ...shared,
        sharedRosterSite: { url: shared.sharedRosterSite!.url, reason: ' ' },
      }),
    ).toBe('shared-roster-site-without-reason');
  });

  it('refuses an unparseable roster url', () => {
    expect(centerRosterPageSiteRefusal(baseConfig, 'not a url')).toBe('unparseable-url');
  });
});

describe('DEFAULT_CENTER_CONFIGS roster sites', () => {
  it('every config declares a home page and crawls a roster on that site', () => {
    const refused = DEFAULT_CENTER_CONFIGS.flatMap((config) => {
      const refusal = centerRosterSiteRefusal(config);
      return refusal ? [`${config.centerKey}: ${refusal}`] : [];
    });
    expect(refused).toEqual([]);
  });

  it('checks real roster subpages, so the guard is not vacuous', () => {
    const rosterSubpages = DEFAULT_CENTER_CONFIGS.filter(
      (config) => config.homeUrl && config.homeUrl !== config.url,
    );
    expect(rosterSubpages.length).toBeGreaterThanOrEqual(30);
  });

  it('every shared roster site states why it may vouch for the center', () => {
    const unreasoned = DEFAULT_CENTER_CONFIGS.filter(
      (config) => config.sharedRosterSite && !config.sharedRosterSite.reason.trim(),
    ).map((config) => config.centerKey);
    expect(unreasoned).toEqual([]);
  });

  it('reads the Cowles Foundation roster from its own site', () => {
    const cowles = DEFAULT_CENTER_CONFIGS.find((config) => config.centerKey === 'cowles')!;
    expect(new URL(cowles.url).hostname).toBe('cowles.yale.edu');
    expect(cowles.homeUrl).toBe('https://cowles.yale.edu/');
    expect(cowles.sharedRosterSite).toBeUndefined();
  });
});

describe('CentersInstitutesScraper.run roster site guard', () => {
  it('fetches nothing and emits nothing for a roster off the center site, and says why', async () => {
    const extractor = vi.fn(
      (): ExtractorResult => ({ members: [{ name: 'Sample Member', title: 'Professor' }] }),
    );
    const fetcher = vi.fn(async () => '<html></html>');
    const scraper = new CentersInstitutesScraper(
      [
        withConfig({ url: 'https://beta.example.edu/people', extractor }),
        withConfig({ centerKey: 'gamma-center', centerName: 'Gamma Center', extractor }),
      ],
      null,
      fetcher,
    );
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://alpha.example.edu/people', false, scraper.name);
    expect(emitted.some((o) => (o.entityKey ?? '').startsWith('center-alpha-center'))).toBe(false);
    expect(emitted.some((o) => (o.entityKey ?? '').startsWith('center-gamma-center'))).toBe(true);
    expect(result.notes).toContain('alpha-center=roster-site-refused:roster-off-center-host');
    expect(logs.some((line) => line.includes('Refused 1 center roster(s)'))).toBe(true);
  });

  it('refuses a rendered roster whose final page left the center site', async () => {
    const extractor = vi.fn((): ExtractorResult => ({ members: [{ name: 'Sample Member' }] }));
    const renderedFetcher = vi.fn().mockResolvedValue({
      html: '<html><body>hydrated</body></html>',
      url: 'https://beta.example.edu/people',
      fetchMode: 'scrapling',
    });
    const scraper = new CentersInstitutesScraper(
      [withConfig({ jsRenderedSkip: true, extractor })],
      renderedFetcher,
    );
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(extractor).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result.notes).toContain('alpha-center=roster-site-refused:roster-off-center-host');
  });
});

describe('title-derived center leadership', () => {
  const card = (title: string) => `
    <article class="node-teaser node-teaser--person">
      <div class="node-teaser__heading"><a href="/people/sample"><span>Sample Member</span></a></div>
      <div class="node-teaser__professional-title">${title}</div>
    </article>`;
  const roleFor = (title: string, centerName = 'Alpha Foundation for Research in Synthetics') =>
    nodeTeaserPersonExtractor(`<html><body>${card(title)}</body></html>`, {
      pageUrl: 'https://alpha.example.edu/people',
      centerName,
    }).members[0].role;

  it('keeps a current directorship of the center being read', () => {
    expect(roleFor('Alpha Foundation Director; Professor of Synthetics')).toBe('director');
    expect(roleFor('Director and Professor of Synthetics')).toBe('director');
    expect(roleFor('Director of the Alpha Foundation')).toBe('director');
    expect(roleFor('Deputy Director of the Alpha Foundation')).toBe('co-director');
  });

  it('does not make a past director a current lead', () => {
    expect(roleFor('Professor of Synthetics; Alpha Foundation Director (2011-14)')).toBe(
      'core-faculty',
    );
    expect(roleFor('Professor Emeritus; Alpha Foundation Director (1971-73, 1976-81)')).toBe(
      'core-faculty',
    );
    expect(roleFor('Former Director of the Alpha Foundation')).toBe('core-faculty');
  });

  it('does not make the director of another unit a lead of this one', () => {
    expect(roleFor('Professor and Faculty Director of the Beta Center for Policy')).toBe(
      'core-faculty',
    );
    expect(roleFor('Director of Graduate Studies in Synthetics')).toBe('core-faculty');
    expect(roleFor('Lecturer and Faculty Co-Director, Beta MA Program')).toBe('core-faculty');
  });

  it('keeps a comma-form directorship that names this center or no unit at all', () => {
    expect(roleFor('Director, Alpha Foundation Outreach Program')).toBe('director');
    expect(roleFor('Director, Finance and Administration')).toBe('director');
  });

  it('recognizes the center by its initials', () => {
    expect(
      roleFor('Director of ISPS and Professor', 'Institution for Social and Policy Studies'),
    ).toBe('director');
  });

  it('keeps a directorship ending in the present as current', () => {
    expect(roleFor('Alpha Foundation Director (2020-present)')).toBe('director');
  });
});
