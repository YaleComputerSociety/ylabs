import { describe, expect, it } from 'vitest';
import {
  isPersonRowForProfileHomeClaims,
  profileHomeOrganizationClaimKeys,
  withoutPersonRowOrganizationHomeClaims,
} from '../personRowOrganizationClaims';

const LANE = 'official-profile-pi-backfill';

describe('which rows are a person row for the profile lane (#5283)', () => {
  it.each([
    ['a grant shell', 'nih-pi-avery-quillfixture', ''],
    ['a key naming only the lead', 'ysm-faculty-avery-quillfixture', 'Avery Quillfixture'],
    ["a key for the lead's lab under a netid", 'quillfixture-lab-aq12', 'Avery Quillfixture'],
  ])('counts %s', (_shape, slug, leadPersonName) => {
    expect(isPersonRowForProfileHomeClaims({ slug, leadPersonName }, [])).toBe(true);
  });

  it('counts a row another source calls faculty research, never the lane itself', () => {
    const slug = 'dept-fixture-studies-avery-quillfixture';
    const fra = {
      sourceName: 'dept-faculty-roster',
      field: 'entityType',
      value: 'FACULTY_RESEARCH_AREA',
    };
    expect(isPersonRowForProfileHomeClaims({ slug }, [fra])).toBe(true);
    expect(isPersonRowForProfileHomeClaims({ slug }, [{ ...fra, sourceName: LANE }])).toBe(false);
  });

  it("does not count an organization's own row", () => {
    expect(
      isPersonRowForProfileHomeClaims(
        { slug: 'fixture-coastal-studies-center', leadPersonName: 'Avery Quillfixture' },
        [],
      ),
    ).toBe(false);
  });
});

describe("the lane's organization reads on a person row", () => {
  const read = (run: string, field: string, value: string, sourceName = LANE) => ({
    sourceName,
    field,
    value,
    scrapeRunId: run,
  });

  it('drops every identity field of an organization read and nothing else', () => {
    const observations = [
      read('a', 'name', 'Fixture Coastal Collaborative'),
      read('a', 'entityType', 'INITIATIVE'),
      read('a', 'websiteUrl', 'https://fixture.example.org/'),
      read('b', 'name', 'Quillfixture Lab'),
      read('b', 'entityType', 'LAB'),
      read('a', 'name', 'Avery Quillfixture Faculty Research', 'dept-faculty-roster'),
    ];
    const kept = withoutPersonRowOrganizationHomeClaims(
      observations,
      profileHomeOrganizationClaimKeys(observations),
    );
    expect(kept.map((o) => `${o.sourceName}:${o.field}=${o.value}`)).toEqual([
      `${LANE}:websiteUrl=https://fixture.example.org/`,
      `${LANE}:name=Quillfixture Lab`,
      `${LANE}:entityType=LAB`,
      'dept-faculty-roster:name=Avery Quillfixture Faculty Research',
    ]);
  });
});
