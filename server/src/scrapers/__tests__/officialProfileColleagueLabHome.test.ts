import { describe, expect, it } from 'vitest';
import { withoutUnpairedProfileHomeIdentity } from '../entityMaterializer';
import { withoutLaneRefusedResearchHomeNames } from '../laneRefusedResearchHomeName';
import {
  extractOfficialProfileResearchHomes,
  hostLabWebsiteOnlyObservations,
  profileLinkedHomeRefusal,
} from '../sources/officialProfilePiBackfillScraper';

const profileUrl = 'https://medicine.yale.edu/profile/jane-quillfixture/';
const roster: ReadonlySet<string> = new Set(['quillfixture', 'marlowfixture']);
const row = { _id: '0123456789abcdef01234567', slug: 'ysm-faculty-jane-quillfixture' };

const cardHtml = (labName: string, href: string) => `
  <html><head>
    <script type="application/ld+json">
      {"@type": "ProfilePage", "mainEntity": {"@type": "Person", "name": "Jane Quillfixture"}}
    </script>
  </head><body><main><h1>Jane Quillfixture</h1>
    <article>${labName}<a href="${href}">View Lab Website</a></article>
  </main></body></html>`;

const homeFrom = (labName: string, href: string) =>
  extractOfficialProfileResearchHomes(cardHtml(labName, href), profileUrl)[0];

describe("a profile card naming a colleague's eponymous lab", () => {
  it('is refused when the eponym is another known researcher', () => {
    const home = homeFrom('Marlowfixture Lab', 'https://www.marlowfixturelaboratory.example.org/');
    expect(home).toBeDefined();
    expect(profileLinkedHomeRefusal(row, home, 'Jane Quillfixture', roster)).toBe(
      'names-a-colleagues-lab',
    );
  });

  it.each([
    ['a nobiliary particle', 'De Marlowfixture Lab'],
    ['a plural head noun', 'Marlowfixture Labs'],
    ['a possessive', "Marlowfixture's Laboratory"],
    ['trailing text', 'Marlowfixture Lab at the School of Medicine'],
  ])('is refused when the eponym carries %s', (_shape, labName) => {
    const home = homeFrom(labName, 'https://www.marlowfixturelaboratory.example.org/');
    expect(home).toBeDefined();
    expect(profileLinkedHomeRefusal(row, home, 'Jane Quillfixture', roster)).toBe(
      'names-a-colleagues-lab',
    );
  });

  it("keeps the profile person's own eponymous lab", () => {
    const home = homeFrom('Quillfixture Lab', 'https://www.quillfixturelab.example.org/');
    expect(profileLinkedHomeRefusal(row, home, 'Jane Quillfixture', roster)).toBeNull();
  });

  it('keeps a topic-named lab whose first word is not a known surname', () => {
    const home = homeFrom('Proteomics Lab', 'https://www.fixtureproteomics.example.org/');
    expect(profileLinkedHomeRefusal(row, home, 'Jane Quillfixture', roster)).toBeNull();
  });

  it('judges nothing without a roster', () => {
    const home = homeFrom('Marlowfixture Lab', 'https://www.marlowfixturelaboratory.example.org/');
    expect(profileLinkedHomeRefusal(row, home, 'Jane Quillfixture')).toBeNull();
  });
});

describe('a profile card linking through a URL shortener', () => {
  it('adopts no home from a third-party shortener', () => {
    expect(homeFrom('Quillfixture Lab', 'https://t.co/AbCdEf123')).toBeUndefined();
  });

  it("keeps Yale's own shortener", () => {
    expect(homeFrom('Quillfixture Lab', 'https://m.yale.edu/quillfixture/')?.url).toBe(
      'https://m.yale.edu/quillfixture/',
    );
  });
});

describe("the website a member's profile gives a colleague's lab", () => {
  it('asserts the website and citations only, never the lab name or type', () => {
    const home = homeFrom('Marlowfixture Lab', 'https://www.marlowfixturelaboratory.example.org/');
    const observations = hostLabWebsiteOnlyObservations(row, home, profileUrl);
    expect(observations.map((obs) => obs.field).sort()).toEqual([
      'refusedResearchHomeName',
      'sourceUrls',
      'website',
      'websiteUrl',
    ]);
    expect(observations.find((obs) => obs.field === 'websiteUrl')?.value).toBe(
      'https://www.marlowfixturelaboratory.example.org/',
    );
  });
});

describe("a colleague's lab name the lane adopted before it refused it", () => {
  const source = 'official-profile-pi-backfill';
  const rowIdentities = new Set([row._id, row.slug]);
  const graftedAt = new Date('2026-09-01T00:00:00Z');
  const refusedAt = new Date('2026-10-15T00:00:00Z');
  const lane = (field: string, value: unknown, observedAt: Date, sourceName = source) => ({
    sourceName,
    entityKey: row.slug,
    field,
    value,
    observedAt,
  });

  const resolveInputs = () => {
    const home = homeFrom('Marlowfixture Lab', 'https://www.marlowfixturelaboratory.example.org/');
    const reRead = hostLabWebsiteOnlyObservations(row, home, profileUrl).map((obs) =>
      lane(obs.field, obs.value, refusedAt),
    );
    return [
      lane('name', 'Marlowfixture Lab', graftedAt),
      lane('displayName', 'Marlowfixture Lab', graftedAt),
      lane('kind', 'lab', graftedAt),
      lane('entityType', 'LAB', graftedAt),
      lane('name', 'Jane Quillfixture', graftedAt, 'ysm-faculty-directory'),
      ...reRead,
    ];
  };

  it('withdraws the old name, kind and type while keeping the website and rival names', () => {
    const resolved = withoutUnpairedProfileHomeIdentity(
      withoutLaneRefusedResearchHomeNames(resolveInputs(), rowIdentities),
      undefined,
    );
    const laneFields = resolved
      .filter((obs) => obs.sourceName === source)
      .map((obs) => obs.field)
      .sort();
    expect(laneFields).toEqual(['sourceUrls', 'website', 'websiteUrl']);
    expect(resolved.filter((obs) => obs.field === 'name').map((obs) => obs.value)).toEqual([
      'Jane Quillfixture',
    ]);
  });

  it('keeps a name the lane asserted after the refusal', () => {
    const later = lane('name', 'Marlowfixture Lab', new Date('2026-11-01T00:00:00Z'));
    const resolved = withoutLaneRefusedResearchHomeNames(
      [...resolveInputs(), later],
      rowIdentities,
    );
    expect(resolved).toContain(later);
  });
});
