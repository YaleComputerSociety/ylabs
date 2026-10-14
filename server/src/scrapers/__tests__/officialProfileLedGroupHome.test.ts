import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractLeadHomepageResearchHomes,
  leadPersonalHomepageUrl,
  ledGroupNameFromLinkSentence,
  OfficialProfilePiBackfillScraper,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { ResearchEntity } from '../../models/researchEntity';

const homepageUrl = 'https://www.cs.yale.edu/homes/quillfixture/';
const profileUrl =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/jane-quillfixture/';

const homepageHtml = (body: string) => `
  <html><head><title>Jane Quillfixture</title></head>
  <body><h1>Jane Quillfixture</h1><main>${body}</main></body></html>`;

describe('ledGroupNameFromLinkSentence', () => {
  it('names a group a first-person homepage says the person leads', () => {
    expect(
      ledGroupNameFromLinkSentence(
        'I work on verified systems. I lead the ORCA group at Yale.',
        'ORCA',
        'Jane Quillfixture',
      ),
    ).toBe('ORCA Group');
  });

  it('names a group a third-person sentence says the person is leading', () => {
    expect(
      ledGroupNameFromLinkSentence(
        'Jane Quillfixture is leading the Fixture Systems Engineering (FSE) group.',
        'Fixture Systems Engineering (FSE)',
        'Jane Quillfixture',
      ),
    ).toBe('Fixture Systems Engineering (FSE) Group');
  });

  it('keeps an anchor that already carries its group noun', () => {
    expect(
      ledGroupNameFromLinkSentence(
        'She directs the Fixture Robotics Lab.',
        'Fixture Robotics Lab',
        'Jane Quillfixture',
      ),
    ).toBe('');
    expect(
      ledGroupNameFromLinkSentence(
        'Quillfixture directs the Fixture Robotics Lab.',
        'Fixture Robotics Lab',
        'Jane Quillfixture',
      ),
    ).toBe('Fixture Robotics Lab');
  });

  it('refuses membership in an umbrella lab', () => {
    expect(
      ledGroupNameFromLinkSentence(
        'Jane Quillfixture is part of the Fixture Systems Lab at Yale.',
        'Fixture Systems Lab',
        'Jane Quillfixture',
      ),
    ).toBe('');
  });

  it("refuses a group another person leads on this person's page", () => {
    expect(
      ledGroupNameFromLinkSentence(
        'Mara Otherfixture leads the ORCA group, where Jane is a member.',
        'ORCA',
        'Jane Quillfixture',
      ),
    ).toBe('');
  });

  it('refuses a led phrase with no group noun after the anchor', () => {
    expect(
      ledGroupNameFromLinkSentence('I lead the ORCA project.', 'ORCA', 'Jane Quillfixture'),
    ).toBe('');
  });
});

describe('extractLeadHomepageResearchHomes', () => {
  it('adopts the led group and lands on the home page of a site the group owns', () => {
    const homes = extractLeadHomepageResearchHomes(
      homepageHtml(
        '<p>Jane Quillfixture is leading the <a href="https://fse.yale.edu/members">Fixture Systems Engineering (FSE)</a> group.</p>',
      ),
      homepageUrl,
      'Jane Quillfixture',
    );
    expect(homes).toEqual([
      expect.objectContaining({
        name: 'Fixture Systems Engineering (FSE) Group',
        url: 'https://fse.yale.edu/',
        entityType: 'LAB',
        leadershipEvidenced: true,
      }),
    ]);
  });

  it('keeps the linked path on a shared host whose root names the host organization', () => {
    const [home] = extractLeadHomepageResearchHomes(
      homepageHtml('<p>I lead the <a href="https://csl.yale.edu/~orca/">ORCA</a> group.</p>'),
      homepageUrl,
      'Jane Quillfixture',
    );
    expect(home?.url).toBe('https://csl.yale.edu/~orca/');
  });

  it("keeps the linked path on an umbrella's subdomain the group's name does not own", () => {
    const [home] = extractLeadHomepageResearchHomes(
      homepageHtml(
        '<p>I lead the <a href="https://fixtureinstitute.yale.edu/groups/orca/">ORCA</a> group.</p>',
      ),
      homepageUrl,
      'Jane Quillfixture',
    );
    expect(home).toMatchObject({
      name: 'ORCA Group',
      url: 'https://fixtureinstitute.yale.edu/groups/orca/',
    });
  });

  it('admits only a led-group sentence, not the arms that read an official profile', () => {
    expect(
      extractLeadHomepageResearchHomes(
        homepageHtml(
          '<p><a href="https://fixturerobotics.yale.edu/">Quillfixture Lab</a></p>' +
            '<p>Collaborators: <a href="https://otherfixture.yale.edu/">View Lab Website</a></p>',
        ),
        homepageUrl,
        'Jane Quillfixture',
      ),
    ).toEqual([]);
  });

  it('adopts nothing from a page that only states membership', () => {
    expect(
      extractLeadHomepageResearchHomes(
        homepageHtml(
          '<p>Jane Quillfixture is part of the <a href="https://csl.yale.edu/">Fixture Systems Lab</a>.</p>',
        ),
        homepageUrl,
        'Jane Quillfixture',
      ),
    ).toEqual([]);
  });
});

describe('leadPersonalHomepageUrl', () => {
  it("returns the lead's own home-directory page the row cites", () => {
    expect(
      leadPersonalHomepageUrl(
        { websiteUrl: 'https://www.cs.yale.edu/homes/quillfixture', sourceUrls: [profileUrl] },
        'Jane Quillfixture',
      ),
    ).toBe(homepageUrl);
    expect(
      leadPersonalHomepageUrl(
        { sourceUrls: ['https://fixture.cs.yale.edu/~jane-quillfixture/'] },
        'Jane Quillfixture',
      ),
    ).toBe('https://fixture.cs.yale.edu/~jane-quillfixture/');
  });

  it("returns a compound surname's home-directory page", () => {
    expect(
      leadPersonalHomepageUrl(
        { sourceUrls: ['https://www.cs.yale.edu/homes/jane-van-quillfixture/'] },
        'Jane van Quillfixture',
      ),
    ).toBe('https://www.cs.yale.edu/homes/jane-van-quillfixture/');
  });

  it("refuses a colleague's homepage and a non-Yale host", () => {
    expect(
      leadPersonalHomepageUrl(
        {
          websiteUrl: 'https://www.cs.yale.edu/homes/otherfixture/',
          sourceUrls: ['https://example.org/homes/quillfixture/'],
        },
        'Jane Quillfixture',
      ),
    ).toBe('');
  });
});

describe('profile-research-home-backfill run', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the lead's homepage when the profile links no home and adopts the led group", async () => {
    vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const profileHtml = `
      <html><head>
        <script type="application/ld+json">
          {"@type": "ProfilePage", "mainEntity": {"@type": "Person",
            "name": "Jane Quillfixture", "email": "jane.example@yale.edu",
            "jobTitle": "Professor of Computer Science"}}
        </script>
      </head><body><main><h1>Jane Quillfixture</h1>
        <p>Jane Quillfixture is a professor of computer science.</p>
      </main></body></html>`;
    const fetchHtml = vi.fn(async (url: string) =>
      url === homepageUrl
        ? homepageHtml(
            '<p>I lead the <a href="https://orca.cs-fixture.yale.edu">ORCA</a> group at Yale.</p>',
          )
        : profileHtml,
    );
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      fetchHtml,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-led-group',
          name: 'Jane Quillfixture Research',
          slug: 'faculty-research-area-led-group-fixture',
          websiteUrl: homepageUrl,
          sourceUrls: [homepageUrl, profileUrl],
          leadUserProfileUrls: [profileUrl],
          leadUsers: [{ fname: 'Jane', lname: 'Quillfixture', email: 'jane.example@yale.edu' }],
        },
      ]),
    );
    const context: ScraperContext = {
      scrapeRunId: 'run-1',
      sourceId: 'source-1',
      sourceName: 'official-profile-pi-backfill',
      sourceWeight: 0.95,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        only: ['profile-research-home-backfill'],
      },
      emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      }),
      log: vi.fn(),
    };

    await scraper.run(context);

    expect(fetchHtml).toHaveBeenCalledWith(homepageUrl, false, expect.anything());
    const byField = Object.fromEntries(emitted.map((obs) => [obs.field, obs]));
    expect(byField.name).toMatchObject({ value: 'ORCA Group', sourceUrl: homepageUrl });
    expect(byField.websiteUrl).toMatchObject({ value: 'https://orca.cs-fixture.yale.edu/' });
    expect(byField.entityType).toMatchObject({ value: 'LAB' });
  });
});
