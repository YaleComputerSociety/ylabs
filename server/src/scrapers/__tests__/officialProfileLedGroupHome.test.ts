import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acronymLabNameExpansion,
  extractLeadHomepageResearchHomes,
  leadPersonalHomepageUrl,
  leadPersonalSiteCandidateUrl,
  ledGroupNameFromLinkSentence,
  OfficialProfilePiBackfillScraper,
  PERSONAL_SITE_ONLY_TARGET_FIELD,
  personalSiteNamesItsLead,
  profileLinkedHomeRefusal,
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

const personalSiteUrl = 'https://www.janequillfixture.example/';
const acronymLabUrl = 'https://www.janequillfixture.example/qmsr/index.html';

describe('leadPersonalSiteCandidateUrl', () => {
  it("returns a faculty research row's own website on any host", () => {
    expect(
      leadPersonalSiteCandidateUrl({
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: `${personalSiteUrl}#about`,
      }),
    ).toBe(personalSiteUrl);
  });

  it('refuses a row that already carries its own name', () => {
    expect(leadPersonalSiteCandidateUrl({ entityType: 'LAB', websiteUrl: personalSiteUrl })).toBe(
      '',
    );
  });

  it('returns the personal site this lane adopted a led group from', () => {
    expect(
      leadPersonalSiteCandidateUrl({
        entityType: 'LAB',
        websiteUrl: 'https://www.orcafixture.example/',
        fieldProvenance: {
          websiteUrl: { sourceName: 'official-profile-pi-backfill', sourceUrl: personalSiteUrl },
        },
      }),
    ).toBe(personalSiteUrl);
  });

  it('refuses a profile this lane adopted a home from', () => {
    expect(
      leadPersonalSiteCandidateUrl({
        entityType: 'LAB',
        websiteUrl: 'https://www.orcafixture.example/',
        leadUserProfileUrls: [profileUrl],
        fieldProvenance: {
          websiteUrl: { sourceName: 'official-profile-pi-backfill', sourceUrl: profileUrl },
        },
      }),
    ).toBe('');
  });

  it("refuses an institution's person page and a directory", () => {
    for (const websiteUrl of [
      'https://medicine.yale.edu/profile/jane-quillfixture/',
      'https://www.fixture-university.example/faculty/jane-quillfixture/',
      'https://www.fixturelab.example/people/',
      homepageUrl,
    ]) {
      expect(
        leadPersonalSiteCandidateUrl({ entityType: 'FACULTY_RESEARCH_AREA', websiteUrl }),
      ).toBe('');
    }
  });
});

describe('personalSiteNamesItsLead', () => {
  it("accepts a page whose title or heading is the lead's name", () => {
    expect(
      personalSiteNamesItsLead(
        '<html><head><title>Jane M. Quillfixture</title></head><body></body></html>',
        'Jane Quillfixture',
      ),
    ).toBe(true);
    expect(
      personalSiteNamesItsLead(
        '<html><head><title>Home</title></head><body><h1>Jane Quillfixture | Systems Researcher</h1></body></html>',
        'Jane Quillfixture',
      ),
    ).toBe(true);
  });

  it("refuses a lab's, a colleague's and a department's page", () => {
    for (const title of [
      'Quillfixture Lab',
      'Mara Otherfixture',
      'Department of Fixture Science',
      'Jane Quillfixture and Mara Otherfixture',
    ]) {
      expect(
        personalSiteNamesItsLead(
          `<html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`,
          'Jane Quillfixture',
        ),
      ).toBe(false);
    }
  });
});

describe('acronymLabNameExpansion', () => {
  it('finds the phrase an acronym lab name abbreviates', () => {
    expect(
      acronymLabNameExpansion(
        'QMSR Lab',
        'QMSR Lab Quillfixture Model Systems Research Lab · Yale University. The QMSR Lab studies.',
      ),
    ).toBe('Quillfixture Model Systems Research Lab');
    expect(
      acronymLabNameExpansion('QMSR Lab', 'The Quillfixture Lab for Model Systems Research'),
    ).toBe('');
  });

  it('skips connectors and requires the head noun', () => {
    expect(acronymLabNameExpansion('QSF Group', 'the Quillfixture Systems of Fixtures Group')).toBe(
      'Quillfixture Systems of Fixtures Group',
    );
    expect(acronymLabNameExpansion('QMSR Lab', 'Quillfixture Model Systems Research')).toBe('');
  });
});

describe('profileLinkedHomeRefusal on an acronym lab', () => {
  const entity = { slug: 'faculty-research-area-quillfixture-fixture' };
  const home = {
    name: 'QMSR Lab',
    rawName: 'QMSR Lab',
    url: acronymLabUrl,
    kind: 'lab' as const,
    entityType: 'LAB' as const,
    score: 20,
    leadershipEvidenced: true,
  };

  it("keeps the lead's own acronym lab whose expansion carries the lead's surname", () => {
    expect(profileLinkedHomeRefusal(entity, home, 'Jane Quillfixture')).toBe(
      'names-another-persons-lab',
    );
    expect(
      profileLinkedHomeRefusal(
        entity,
        { ...home, acronymExpansion: 'Quillfixture Model Systems Research Lab' },
        'Jane Quillfixture',
      ),
    ).toBeNull();
  });

  it('still refuses an acronym lab whose expansion names someone else', () => {
    expect(
      profileLinkedHomeRefusal(
        entity,
        { ...home, acronymExpansion: 'Quintfixture Model Systems Research Lab' },
        'Jane Quillfixture',
      ),
    ).toBe('names-another-persons-lab');
  });
});

const fixtureProfileHtml = `
  <html><head>
    <script type="application/ld+json">
      {"@type": "ProfilePage", "mainEntity": {"@type": "Person",
        "name": "Jane Quillfixture", "email": "jane.example@yale.edu",
        "jobTitle": "Professor of Computer Science"}}
    </script>
  </head><body><main><h1>Jane Quillfixture</h1>
    <p>Jane Quillfixture is a professor of computer science.</p>
  </main></body></html>`;

async function runResearchHomeStep(
  pages: Record<string, string>,
  entity: Record<string, any>,
): Promise<{ emitted: ObservationInput[]; fetched: string[] }> {
  vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(null),
  } as any);
  const fetched: string[] = [];
  const fetchHtml = vi.fn(async (url: string) => {
    fetched.push(url);
    return pages[url] ?? fixtureProfileHtml;
  });
  const emitted: ObservationInput[] = [];
  const scraper = new OfficialProfilePiBackfillScraper(
    fetchHtml,
    vi.fn(async () => []),
    vi.fn(async () => null),
    vi.fn(async () => []),
    vi.fn(async () => [entity]),
  );
  await scraper.run({
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
  });
  return { emitted, fetched };
}

const personalSiteEntity = {
  _id: 'entity-personal-site',
  name: 'Jane Quillfixture Faculty Research',
  slug: 'faculty-research-area-personal-site-fixture',
  entityType: 'FACULTY_RESEARCH_AREA',
  websiteUrl: personalSiteUrl,
  sourceUrls: [profileUrl],
  leadUserProfileUrls: [profileUrl],
  leadUsers: [{ fname: 'Jane', lname: 'Quillfixture', email: 'jane.example@yale.edu' }],
};

const emittedByField = (emitted: ObservationInput[]) =>
  Object.fromEntries(emitted.map((obs) => [obs.field, obs]));

describe('profile-research-home-backfill on a lead personal site', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adopts the group the lead's own site on any host says the lead leads", async () => {
    const { emitted } = await runResearchHomeStep(
      {
        [personalSiteUrl]: homepageHtml(
          '<p>I lead the <a href="https://www.orcafixture.example/">ORCA Lab</a> at Yale.</p>',
        ),
      },
      personalSiteEntity,
    );
    const byField = emittedByField(emitted);
    expect(byField.name).toMatchObject({ value: 'ORCA Lab', sourceUrl: personalSiteUrl });
    expect(byField.websiteUrl).toMatchObject({ value: 'https://www.orcafixture.example/' });
    expect(byField.entityType).toMatchObject({ value: 'LAB' });
  });

  it('adopts nothing from a site whose title names someone other than the lead', async () => {
    const { emitted } = await runResearchHomeStep(
      {
        [personalSiteUrl]: `<html><head><title>Mara Otherfixture</title></head><body><h1>Mara Otherfixture</h1>
          <main><p>I lead the <a href="https://www.orcafixture.example/">ORCA Lab</a> at Yale.</p></main></body></html>`,
      },
      personalSiteEntity,
    );
    expect(emittedByField(emitted).name).toBeUndefined();
  });

  it("adopts the lead's acronym lab once its own page spells the acronym out", async () => {
    const { emitted, fetched } = await runResearchHomeStep(
      {
        [personalSiteUrl]: homepageHtml(
          '<p>I also direct the <a href="/qmsr/index.html">QMSR Lab</a>, which builds datasets.</p>',
        ),
        [acronymLabUrl]: `<html><head><title>QMSR Lab</title></head><body><h1>QMSR Lab</h1>
          <p>Quillfixture Model Systems Research Lab · Yale University</p></body></html>`,
      },
      personalSiteEntity,
    );
    expect(fetched).toContain(acronymLabUrl);
    const byField = emittedByField(emitted);
    expect(byField.name).toMatchObject({ value: 'QMSR Lab', sourceUrl: personalSiteUrl });
    expect(byField.websiteUrl).toMatchObject({ value: acronymLabUrl });
  });

  it('reads only the personal site on a row selected for it alone', async () => {
    const { emitted, fetched } = await runResearchHomeStep(
      {
        [profileUrl]: fixtureProfileHtml.replace(
          '</main>',
          '<p><a href="https://www.quillfixturelab.example/">Quillfixture Lab</a></p></main>',
        ),
        [personalSiteUrl]: homepageHtml('<p>Welcome to my page.</p>'),
      },
      { ...personalSiteEntity, [PERSONAL_SITE_ONLY_TARGET_FIELD]: true },
    );
    expect(fetched).toContain(personalSiteUrl);
    expect(emittedByField(emitted).name).toBeUndefined();
    expect(emittedByField(emitted).websiteUrl).toBeUndefined();
  });
  it('re-derives the adopted group from the same personal site on a second run', async () => {
    const pages = {
      [personalSiteUrl]: homepageHtml(
        '<p>I lead the <a href="https://www.orcafixture.example/">ORCA Lab</a> at Yale.</p>',
      ),
    };
    const first = emittedByField((await runResearchHomeStep(pages, personalSiteEntity)).emitted);
    const adoptedEntity = {
      ...personalSiteEntity,
      name: first.name.value,
      entityType: first.entityType.value,
      websiteUrl: first.websiteUrl.value,
      sourceUrls: first.sourceUrls.value,
      fieldProvenance: {
        websiteUrl: {
          sourceName: 'official-profile-pi-backfill',
          sourceUrl: first.websiteUrl.sourceUrl,
        },
      },
    };
    const second = emittedByField((await runResearchHomeStep(pages, adoptedEntity)).emitted);
    expect(second.name).toMatchObject({ value: 'ORCA Lab', sourceUrl: personalSiteUrl });
    expect(second.websiteUrl).toMatchObject({ value: 'https://www.orcafixture.example/' });
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
