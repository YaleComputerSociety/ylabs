import { describe, expect, it, vi } from 'vitest';

import {
  centerRosterReadAdmissibility,
  type CenterRosterHealthSnapshot,
} from '../centerRosterRetirement';
import {
  OfficialProfilePiBackfillScraper,
  organizationDirectorClaimFromProfile,
  organizationDirectorObservations,
  profileTextStatesDirectorshipOf,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';

const profileUrl = 'https://medicine.yale.edu/profile/rowan-fixturedirector/';
const programUrl =
  'https://medicine.yale.edu/psychiatry/research/clinics-and-programs/fixture-mood/';

const organization = {
  _id: '64f0000000000000000000a1',
  slug: 'fixturedirector-lab-rf12',
  name: 'Fixture Mood Research Program',
  entityType: 'INITIATIVE',
  websiteUrl: programUrl,
  sourceUrls: [profileUrl, programUrl],
};

const profileHtml = (body: string) => `
  <html><head>
    <title>Rowan Fixturedirector, MD | Yale School of Medicine</title>
    <link rel="canonical" href="${profileUrl}" />
  </head>
  <body><main>
    <h1>Rowan Fixturedirector, MD</h1>
    <p>Professor of Psychiatry</p>
    ${body}
  </main></body></html>`;

const statesAndLinks = profileHtml(`
  <section>
    <h3>Fixture Mood Research Program</h3>
    <p>Dr. Fixturedirector is the Director of the Fixture Mood Research Program</p>
    <a href="${programUrl}">Visit Website</a>
  </section>`);

function contextFor(emitted: ObservationInput[], only: string[], useCache = false): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'official-profile-pi-backfill',
    sourceWeight: 0.95,
    options: { dryRun: true, useCache, release: false, only },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn(),
  };
}

function scraperReading(
  html: string,
  targets: Array<Record<string, any>>,
  fetcher: (url: string, useCache: boolean, sourceName: string) => Promise<string> = vi.fn(
    async () => html,
  ),
) {
  const scraper = new OfficialProfilePiBackfillScraper(
    fetcher,
    vi.fn(async () => []),
    vi.fn(async () => null),
    vi.fn(async () => []),
    vi.fn(async () => []),
    vi.fn(async () => []),
    0,
    async () => undefined,
    vi.fn(async () => []),
    vi.fn(async () => []),
    undefined,
    async () => new Set<string>(),
    vi.fn(async () => targets),
  );
  return { scraper, fetcher };
}

describe('profileTextStatesDirectorshipOf', () => {
  it('reads a title line and a sentence naming the organization', () => {
    expect(
      profileTextStatesDirectorshipOf(
        'Professor of Psychiatry | Director, Fixture Mood Research Program | Biography',
        'Fixture Mood Research Program',
      ),
    ).toBe('director');
    expect(
      profileTextStatesDirectorshipOf(
        'She is the Director of The Yale Fixture Mood Research Program (FMRP).',
        'Fixture Mood Research Program',
      ),
    ).toBe('director');
  });

  it('reads a co-directorship as a co-director', () => {
    expect(
      profileTextStatesDirectorshipOf(
        'Co-Director, Fixture Mood Research Program.',
        'Fixture Mood Research Program',
      ),
    ).toBe('co-director');
  });

  it('refuses a qualified directorate', () => {
    for (const title of [
      'Associate Director, Fixture Mood Research Program.',
      'Medical Director of the Fixture Mood Research Program.',
      'Former Director of the Fixture Mood Research Program.',
    ]) {
      expect(profileTextStatesDirectorshipOf(title, 'Fixture Mood Research Program')).toBeNull();
    }
  });

  it('refuses a name the stated unit only begins with', () => {
    expect(
      profileTextStatesDirectorshipOf(
        'Director, Division of Fixture Aging and Geriatric Care',
        'Division of Fixture Aging',
      ),
    ).toBeNull();
  });

  it('refuses a name a title-case sub-unit extends', () => {
    expect(
      profileTextStatesDirectorshipOf(
        'Director, Fixture Mood Research Program Genomics Shared Resource',
        'Fixture Mood Research Program',
      ),
    ).toBeNull();
  });
});

describe('organizationDirectorClaimFromProfile (#5085)', () => {
  it('claims the director when the profile states the role by name and links the site', () => {
    const claim = organizationDirectorClaimFromProfile(statesAndLinks, profileUrl, organization);

    expect(claim).toEqual(
      expect.objectContaining({
        name: 'Rowan Fixturedirector',
        role: 'director',
        profileUrl,
      }),
    );
    expect(organizationDirectorObservations(organization, claim!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchGroupMember',
          entityKey: 'fixturedirector-lab-rf12:rowan-fixturedirector',
          field: 'researchGroupKey',
          value: 'fixturedirector-lab-rf12',
        }),
        expect.objectContaining({ field: 'role', value: 'director', sourceUrl: profileUrl }),
        expect.objectContaining({ field: 'profileUrl', value: profileUrl }),
      ]),
    );
  });

  it('claims the director when the name ends at an element boundary', () => {
    const html = profileHtml(
      `<ul><li>Director, Fixture Mood Research Program</li><li>Professor of Psychiatry</li></ul><a href="${programUrl}">Visit Website</a>`,
    );

    expect(organizationDirectorClaimFromProfile(html, profileUrl, organization)?.role).toBe(
      'director',
    );
  });

  it('claims nothing for the director of a sub-unit that links the parent site', () => {
    const html = profileHtml(
      `<p>Director, Fixture Mood Research Program Genomics Shared Resource</p><a href="${programUrl}">Visit Website</a>`,
    );

    expect(organizationDirectorClaimFromProfile(html, profileUrl, organization)).toBeNull();
  });

  it('claims nothing when the profile states the role but does not link the site', () => {
    const html = profileHtml(
      '<p>Dr. Fixturedirector is the Director of the Fixture Mood Research Program.</p>',
    );

    expect(organizationDirectorClaimFromProfile(html, profileUrl, organization)).toBeNull();
  });

  it('claims nothing when the profile links the site but states no directorship', () => {
    const html = profileHtml(
      `<p>Member, Fixture Mood Research Program.</p><a href="${programUrl}">Visit Website</a>`,
    );

    expect(organizationDirectorClaimFromProfile(html, profileUrl, organization)).toBeNull();
  });

  it('claims nothing for a row with no site of its own', () => {
    expect(
      organizationDirectorClaimFromProfile(statesAndLinks, profileUrl, {
        ...organization,
        websiteUrl: '',
      }),
    ).toBeNull();
  });
});

describe('the organization-director arm of the lane run (#5085)', () => {
  it('emits a director roster observation for a lead-less organization its director profile names', async () => {
    const emitted: ObservationInput[] = [];
    const { scraper, fetcher } = scraperReading(statesAndLinks, [organization]);

    const result = await scraper.run(
      contextFor(emitted, ['profile-organization-director-backfill']),
    );

    expect(fetcher).toHaveBeenCalledWith(profileUrl, false, 'official-profile-pi-backfill');
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchGroupMember',
          entityKey: 'fixturedirector-lab-rf12:rowan-fixturedirector',
          field: 'role',
          value: 'director',
        }),
      ]),
    );
    expect(result.notes).toContain('claimed 1 of 1 lead-less organization directors');
  });

  it('runs the arm when the lane is pointed at entity keys with no explicit mode', async () => {
    const emitted: ObservationInput[] = [];
    const { scraper } = scraperReading(statesAndLinks, [organization]);

    await scraper.run(contextFor(emitted, [organization.slug]));

    expect(emitted.some((obs) => obs.entityType === 'researchGroupMember')).toBe(true);
  });

  it('emits nothing for an organization its profile does not name as directed', async () => {
    const emitted: ObservationInput[] = [];
    const { scraper } = scraperReading(
      profileHtml(`<p>Professor of Psychiatry.</p><a href="${programUrl}">Visit Website</a>`),
      [organization],
    );

    const result = await scraper.run(
      contextFor(emitted, ['profile-organization-director-backfill']),
    );

    expect(emitted.filter((obs) => obs.entityType === 'researchGroupMember')).toEqual([]);
    expect(result.notes).toContain('claimed 0 of 1 lead-less organization directors');
  });
});

describe('the read snapshot the organization-director arm records for retirement (#5091)', () => {
  const heldOrganization = { ...organization, heldDirectorNames: ['Rowan Fixturedirector'] };
  const statesNothing = profileHtml(
    `<p>Professor of Psychiatry.</p><a href="${programUrl}">Visit Website</a>`,
  );

  async function snapshotFrom(
    html: string,
    options: {
      targets?: Array<Record<string, any>>;
      fetcher?: (url: string, useCache: boolean, sourceName: string) => Promise<string>;
      useCache?: boolean;
    } = {},
  ): Promise<CenterRosterHealthSnapshot | undefined> {
    const emitted: ObservationInput[] = [];
    const { scraper } = scraperReading(
      html,
      options.targets ?? [heldOrganization],
      options.fetcher,
    );
    await scraper.run(
      contextFor(emitted, ['profile-organization-director-backfill'], options.useCache),
    );
    const snapshots = emitted.filter((obs) => obs.entityType === 'centerRosterHealth');
    expect(snapshots.length).toBeLessThanOrEqual(1);
    return snapshots[0]?.value as CenterRosterHealthSnapshot | undefined;
  }

  it('records a stated directorship as a listed member of the read', async () => {
    const snapshot = await snapshotFrom(statesAndLinks);

    expect(snapshot && centerRosterReadAdmissibility(snapshot)).toBe('read-listed-members');
    expect(snapshot?.subjectKeys).toEqual([`official-profile:${profileUrl}`]);
  });

  it('records a parsed profile that no longer states the directorship as an absence', async () => {
    const snapshot = await snapshotFrom(statesNothing);

    expect(snapshot && centerRosterReadAdmissibility(snapshot)).toBe('read-subject-stated-nothing');
  });

  it('keeps a profile that still states the role but no longer links the site as listed', async () => {
    const emitted: ObservationInput[] = [];
    const { scraper } = scraperReading(
      profileHtml('<p>Director of the Fixture Mood Research Program</p>'),
      [heldOrganization],
    );
    await scraper.run(contextFor(emitted, ['profile-organization-director-backfill']));

    expect(emitted.filter((obs) => obs.entityType === 'researchGroupMember')).toEqual([]);
    const snapshot = emitted.find((obs) => obs.entityType === 'centerRosterHealth')
      ?.value as CenterRosterHealthSnapshot;
    expect(centerRosterReadAdmissibility(snapshot)).toBe('read-listed-members');
  });

  it('records a failed fetch as a read that is not evidence', async () => {
    const snapshot = await snapshotFrom(statesNothing, {
      fetcher: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    expect(snapshot && centerRosterReadAdmissibility(snapshot)).toBe('not-read');
  });

  it('records a cache-permitted run as a read that is not evidence', async () => {
    const snapshot = await snapshotFrom(statesNothing, { useCache: true });

    expect(snapshot && centerRosterReadAdmissibility(snapshot)).toBe('cache-permitted');
  });

  it('records a page that is another person or did not parse as naming no subject', async () => {
    const otherPerson = statesNothing.replace(
      `<link rel="canonical" href="${profileUrl}" />`,
      '<link rel="canonical" href="https://medicine.yale.edu/profile/someone-else/" />',
    );
    const unparsed = '<html><head></head><body></body></html>';
    const placeholder = `<html><head><title>Page Not Found | Yale School of Medicine</title></head>
      <body><main><h1>Page Not Found</h1><p>The page you requested could not be found.</p></main></body></html>`;

    for (const html of [otherPerson, unparsed, placeholder]) {
      const snapshot = await snapshotFrom(html);
      expect(snapshot && centerRosterReadAdmissibility(snapshot)).toBe('read-listed-nobody');
    }
  });

  it('records nothing for a lead-less row its profile does not name', async () => {
    expect(await snapshotFrom(statesNothing, { targets: [organization] })).toBeUndefined();
  });
});
