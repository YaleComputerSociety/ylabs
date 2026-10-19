import { afterEach, describe, expect, it, vi } from 'vitest';
import { withoutUnpairedProfileHomeIdentity } from '../entityMaterializer';
import { withoutLaneRefusedResearchHomeNames } from '../laneRefusedResearchHomeName';
import {
  ENTITY_TYPES_FROM_OTHER_SOURCES_FIELD,
  extractOfficialProfileResearchHomes,
  OfficialProfilePiBackfillScraper,
  profileLinkedHomeRefusal,
  refusedPersonRowOrganizationObservations,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';

const SOURCE = 'official-profile-pi-backfill';
const person = 'Avery Quillfixture';
const profileUrl = 'https://medicine.yale.edu/profile/avery-quillfixture/';
const collaborativeUrl = 'https://fixturecollaborative.example.org/';

const profileHtml = (cardTitle: string, cardUrl: string, bio: string) => `
  <html><head>
    <link rel="canonical" href="${profileUrl}" />
    <script type="application/ld+json" data-schema="ProfilePage">
      {"@type": "ProfilePage", "mainEntity": {"@type": "Person", "name": "${person}",
       "email": "avery.quillfixture@yale.edu", "jobTitle": "Professor"}}
    </script>
  </head><body><main>
    <h1>${person}</h1>
    <section class="profile-body"><p>${bio}</p></section>
    <article class="profile-details-lab">
      <h3 class="profile-details-lab__title">${cardTitle}</h3>
      <a href="${cardUrl}"><span>View Lab Website</span></a>
    </article>
  </main></body></html>`;

const coFounderBio = `${person} is a co-founder of the Fixture Measurement Care Collaborative.`;
const collaborativeProfile = profileHtml(
  'Fixture Measurement Care Collaborative',
  collaborativeUrl,
  coFounderBio,
);
const homeFrom = (html: string) => extractOfficialProfileResearchHomes(html, profileUrl)[0];

const facultyRow = {
  _id: '0123456789abcdef01234567',
  slug: 'dept-fixture-studies-avery-quillfixture',
  name: 'Avery Quillfixture Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
};

describe('an organization the profile says its person co-founded', () => {
  it('is read as an initiative the person leads', () => {
    expect(homeFrom(collaborativeProfile)).toMatchObject({
      name: 'Fixture Measurement Care Collaborative',
      entityType: 'INITIATIVE',
      leadershipEvidenced: true,
    });
  });

  it("never becomes the name or type of the person's faculty research row", () => {
    expect(profileLinkedHomeRefusal(facultyRow, homeFrom(collaborativeProfile), person)).toBe(
      'organization-home-on-a-faculty-research-row',
    );
  });

  it('is refused on that row whatever organization type it carries', () => {
    const centre = homeFrom(
      profileHtml(
        'Fixture Measurement Center',
        'https://medicine.yale.edu/fixture-measurement-center/',
        `${person} is Director of the Fixture Measurement Center.`,
      ),
    );
    expect(centre).toMatchObject({ entityType: 'CENTER', leadershipEvidenced: true });
    expect(profileLinkedHomeRefusal(facultyRow, centre, person)).toBe(
      'organization-home-on-a-faculty-research-row',
    );
  });

  it('is refused on a row this lane already retyped when another source says it is faculty research', () => {
    const retyped = {
      ...facultyRow,
      name: 'Fixture Measurement Care Collaborative',
      entityType: 'INITIATIVE',
      fieldProvenance: { entityType: { sourceName: SOURCE } },
      [ENTITY_TYPES_FROM_OTHER_SOURCES_FIELD]: ['FACULTY_RESEARCH_AREA'],
    };
    expect(profileLinkedHomeRefusal(retyped, homeFrom(collaborativeProfile), person)).toBe(
      'organization-home-on-a-faculty-research-row',
    );
  });

  it("is still adopted by the organization's own row", () => {
    const organizationRow = {
      _id: '0123456789abcdef01234568',
      slug: 'fixture-measurement-care-collaborative',
      name: 'Fixture Measurement Care Collaborative',
      entityType: 'INITIATIVE',
    };
    expect(
      profileLinkedHomeRefusal(organizationRow, homeFrom(collaborativeProfile), person),
    ).toBeNull();
    expect(
      profileLinkedHomeRefusal(
        {
          ...organizationRow,
          fieldProvenance: { entityType: { sourceName: SOURCE } },
          [ENTITY_TYPES_FROM_OTHER_SOURCES_FIELD]: [],
        },
        homeFrom(collaborativeProfile),
        person,
      ),
    ).toBeNull();
  });
});

describe("a faculty research row's own lab", () => {
  it('is still adopted when it is the eponymous lab the person runs', () => {
    const ownLab = homeFrom(
      profileHtml(
        'Quillfixture Lab',
        'https://medicine.yale.edu/lab/quillfixture/',
        `${person} is a professor of medicine.`,
      ),
    );
    expect(ownLab).toMatchObject({ entityType: 'LAB' });
    expect(profileLinkedHomeRefusal(facultyRow, ownLab, person)).toBeNull();
  });

  it('is still adopted when it is a research group the person leads', () => {
    const ledGroup = homeFrom(
      profileHtml(
        'Fixture Imaging Group',
        'https://fixtureimaging.example.org/',
        `${person} leads the Fixture Imaging Group.`,
      ),
    );
    expect(ledGroup).toMatchObject({ entityType: 'LAB' });
    expect(profileLinkedHomeRefusal(facultyRow, ledGroup, person)).toBeNull();
  });
});

describe('the organization a lane adopted onto a person row before refusing it', () => {
  const rowIdentities = new Set([facultyRow._id, facultyRow.slug]);
  const graftedAt = new Date('2026-09-01T00:00:00Z');
  const refusedAt = new Date('2026-10-18T00:00:00Z');
  const lane = (field: string, value: unknown, observedAt: Date, sourceName = SOURCE) => ({
    sourceName,
    entityKey: facultyRow.slug,
    field,
    value,
    observedAt,
  });

  it('states the refused name and leaves the website the row serves alone', () => {
    const home = homeFrom(collaborativeProfile);
    expect(
      refusedPersonRowOrganizationObservations(
        { ...facultyRow, websiteUrl: collaborativeUrl },
        home,
        profileUrl,
      ).map((o) => ({ field: o.field, value: o.value })),
    ).toEqual([{ field: 'refusedResearchHomeName', value: home.name }]);
  });

  it("withdraws the lane's old name, type and kind and keeps the faculty row's own", () => {
    const home = homeFrom(collaborativeProfile);
    const reRead = refusedPersonRowOrganizationObservations(
      { ...facultyRow, websiteUrl: collaborativeUrl },
      home,
      profileUrl,
    ).map((obs) => lane(obs.field, obs.value, refusedAt));
    const inputs = [
      lane('name', home.name, graftedAt),
      lane('displayName', home.name, graftedAt),
      lane('kind', 'initiative', graftedAt),
      lane('entityType', 'INITIATIVE', graftedAt),
      lane('name', facultyRow.name, graftedAt, 'dept-faculty-roster'),
      lane('entityType', 'FACULTY_RESEARCH_AREA', graftedAt, 'dept-faculty-roster'),
      ...reRead,
    ];
    const resolved = withoutUnpairedProfileHomeIdentity(
      withoutLaneRefusedResearchHomeNames(inputs, rowIdentities),
      undefined,
    );
    expect(resolved.filter((obs) => obs.sourceName === SOURCE)).toEqual([]);
    expect(resolved.map((obs) => `${obs.field}=${obs.value}`)).toEqual([
      `name=${facultyRow.name}`,
      'entityType=FACULTY_RESEARCH_AREA',
    ]);
  });
});

describe('a research-home run over a faculty research row', () => {
  afterEach(() => vi.restoreAllMocks());

  const context = (
    emitted: ObservationInput[],
    only: string[] = ['profile-research-home-backfill'],
  ): ScraperContext => ({
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: SOURCE,
    sourceWeight: 0.95,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      only,
    },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn(),
  });

  it('adopts nothing of the co-founded organization and names the refusing arm', async () => {
    vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const emitted: ObservationInput[] = [];
    const target = {
      ...facultyRow,
      websiteUrl: collaborativeUrl,
      fieldProvenance: { websiteUrl: { sourceName: SOURCE, sourceUrl: profileUrl } },
      sourceUrls: [profileUrl],
      leadUserProfileUrls: [profileUrl],
      leadUsers: [{ fname: 'Avery', lname: 'Quillfixture', email: 'avery.quillfixture@yale.edu' }],
    };
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => collaborativeProfile),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => [target]),
    );

    const result = await scraper.run(context(emitted));

    expect(emitted.map((obs) => obs.field)).toEqual(['refusedResearchHomeName']);
    expect(result.notes).toContain('adopted 0 profile-linked research homes');
    expect(result.notes).toContain('organization-home-on-a-faculty-research-row=1');
  });

  it('refuses the organization in a default sweep that reaches the row through the PI queue first', async () => {
    vi.spyOn(ResearchEntity, 'findOne').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi
        .fn()
        .mockResolvedValue([
          { entityId: facultyRow._id, entityKey: facultyRow.slug, value: 'FACULTY_RESEARCH_AREA' },
        ]),
    } as any);
    const emitted: ObservationInput[] = [];
    const retypedRow = {
      ...facultyRow,
      name: 'Fixture Measurement Care Collaborative',
      entityType: 'INITIATIVE',
      fieldProvenance: { entityType: { sourceName: SOURCE } },
      sourceUrls: [profileUrl],
      leadUserProfileUrls: [profileUrl],
      leadUsers: [{ fname: 'Avery', lname: 'Quillfixture', email: 'avery.quillfixture@yale.edu' }],
    };
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => collaborativeProfile),
      vi.fn(async () => [retypedRow]),
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => [retypedRow]),
      vi.fn(async () => []),
      0,
      vi.fn(async () => undefined),
      vi.fn(async () => []),
      vi.fn(async () => []),
      undefined,
      vi.fn(async () => new Set<string>()),
      vi.fn(async () => []),
    );

    const result = await scraper.run(context(emitted, []));

    const homeFields = ['name', 'displayName', 'entityType', 'kind'];
    expect(
      emitted.filter(
        (obs) =>
          homeFields.includes(obs.field) && obs.value === 'Fixture Measurement Care Collaborative',
      ),
    ).toEqual([]);
    expect(emitted.filter((obs) => obs.field === 'entityType' || obs.field === 'kind')).toEqual([]);
    expect(emitted.map((obs) => obs.field)).toContain('refusedResearchHomeName');
    expect(result.notes).toContain('organization-home-on-a-faculty-research-row=1');
  });
});
