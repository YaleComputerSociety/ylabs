import { describe, expect, it, vi } from 'vitest';

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

function contextFor(emitted: ObservationInput[], only: string[]): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'official-profile-pi-backfill',
    sourceWeight: 0.95,
    options: { dryRun: true, useCache: false, release: false, only },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn(),
  };
}

function scraperReading(html: string, targets: Array<Record<string, any>>) {
  const fetcher = vi.fn(async () => html);
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
        'Professor of Psychiatry Director, Fixture Mood Research Program Biography',
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
