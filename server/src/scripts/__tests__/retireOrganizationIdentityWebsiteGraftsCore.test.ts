import { describe, expect, it } from 'vitest';
import {
  canonicalWebsitePageKey,
  effectiveWebsiteUrl,
  isOrganizationIdentityWebsiteObservation,
  organizationWebsiteIdentityToken,
  organizationsByIdentityToken,
  ownerNameDenotesOrganization,
  planOrganizationIdentityWebsiteGraft,
  urlsToResolve,
  type OrganizationIdentityWebsite,
} from '../retireOrganizationIdentityWebsiteGraftsCore';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';

const CENTER_CANONICAL = 'https://example.edu/demo-school/demo-unit/equity-center/';
const CENTER_VANITY = 'https://equity-center.example.edu';
const CENTER_LEGACY_PATH = 'https://example.edu/dschool/demo-unit/equity-center/';

const center: OrganizationIdentityWebsite = {
  slug: 'center-equity',
  name: 'Fixture Equity Center',
  entityType: 'CENTER',
  websiteUrl: CENTER_CANONICAL,
};

const organizations = organizationsByIdentityToken([center]);

const resolveAliases = (url: string): string =>
  [CENTER_VANITY, CENTER_LEGACY_PATH].includes(url) ? CENTER_CANONICAL : url;

const personRow = (websiteUrl: string, overrides: Record<string, unknown> = {}) => ({
  slug: 'demo-faculty-ada-lovelace',
  name: 'Ada Lovelace Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  websiteUrl,
  ...overrides,
});

describe('organizationWebsiteIdentityToken', () => {
  it('reads the terminal path segment', () => {
    expect(organizationWebsiteIdentityToken(CENTER_CANONICAL)).toBe('equity-center');
  });

  it('reads the host label when the page is a bare vanity subdomain root', () => {
    expect(organizationWebsiteIdentityToken(CENTER_VANITY)).toBe('equity-center');
    expect(organizationWebsiteIdentityToken('https://equity-center.example.edu/')).toBe(
      'equity-center',
    );
  });

  it('refuses a bare registrable domain and a non-http value', () => {
    expect(organizationWebsiteIdentityToken('https://example.edu')).toBe('');
    expect(organizationWebsiteIdentityToken('mailto:someone@example.edu')).toBe('');
    expect(organizationWebsiteIdentityToken(undefined)).toBe('');
  });
});

describe('canonicalWebsitePageKey', () => {
  it('drops the scheme, www, fragment and trailing slash', () => {
    expect(canonicalWebsitePageKey('https://www.example.edu/a/b/#y')).toBe('example.edu/a/b');
    expect(canonicalWebsitePageKey('http://example.edu/a/b')).toBe('example.edu/a/b');
  });

  it('keeps the query, so two pages differing only by query string are not one page', () => {
    expect(canonicalWebsitePageKey('https://example.edu/unit?id=5')).not.toBe(
      canonicalWebsitePageKey('https://example.edu/unit?id=9'),
    );
    expect(canonicalWebsitePageKey('https://www.example.edu/unit/?id=5')).toBe(
      canonicalWebsitePageKey('http://example.edu/unit?id=5'),
    );
  });
});

describe('planOrganizationIdentityWebsiteGraft', () => {
  it('plans a vanity host that resolves to the organization page', () => {
    const plan = planOrganizationIdentityWebsiteGraft(
      personRow(CENTER_VANITY),
      organizations,
      resolveAliases,
    );
    expect(plan).toEqual({
      graftedWebsiteUrl: CENTER_VANITY,
      ownerSlug: 'center-equity',
      ownerEntityType: 'CENTER',
      resolvedPageKey: 'example.edu/demo-school/demo-unit/equity-center',
    });
  });

  it('plans a legacy path alias that resolves to the same organization page', () => {
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow(CENTER_LEGACY_PATH),
        organizations,
        resolveAliases,
      )?.ownerSlug,
    ).toBe('center-equity');
  });

  it('plans the exact organization URL too', () => {
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow(CENTER_CANONICAL),
        organizations,
        resolveAliases,
      )?.ownerSlug,
    ).toBe('center-equity');
  });

  it('refuses a same-token page that resolves somewhere else', () => {
    const otherPage = 'https://other.example.edu/mine/equity-center/';
    expect(
      planOrganizationIdentityWebsiteGraft(personRow(otherPage), organizations, resolveAliases),
    ).toBeNull();
  });

  it('refuses a same-path page that differs from the organization page only by query', () => {
    const queryOwner = organizationsByIdentityToken([
      { ...center, websiteUrl: 'https://example.edu/units/equity-center?unit=5' },
    ]);
    const resolveSelf = (url: string): string => url;
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow('https://example.edu/units/equity-center?unit=9'),
        queryOwner,
        resolveSelf,
      ),
    ).toBeNull();
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow('https://www.example.edu/units/equity-center/?unit=5'),
        queryOwner,
        resolveSelf,
      )?.ownerSlug,
    ).toBe('center-equity');
  });

  it('refuses an owner whose name denotes a person rather than an organization', () => {
    const personOwner = organizationsByIdentityToken([
      { ...center, slug: 'lab-fixture-lovelace', name: 'Lovelace Lab' },
    ]);
    expect(
      planOrganizationIdentityWebsiteGraft(personRow(CENTER_VANITY), personOwner, resolveAliases),
    ).toBeNull();
  });

  it('accepts a shared facility owner, which is never umbrella-named', () => {
    const facilityOwner = organizationsByIdentityToken([
      {
        ...center,
        slug: 'core-fixture-cryoem',
        entityType: 'CORE_FACILITY',
        name: 'Fixture CryoEM Resource',
      },
    ]);
    expect(
      planOrganizationIdentityWebsiteGraft(personRow(CENTER_VANITY), facilityOwner, resolveAliases)
        ?.ownerSlug,
    ).toBe('core-fixture-cryoem');
  });

  it('converges a row an earlier apply cleared without locking the slot', () => {
    const clearedRow = personRow('', {
      website: '',
      sourceUrls: ['https://example.edu/demo-school/profile/ada-lovelace/', CENTER_VANITY],
    });
    expect(effectiveWebsiteUrl(clearedRow)).toBe(CENTER_VANITY);
    expect(
      planOrganizationIdentityWebsiteGraft(clearedRow, organizations, resolveAliases)?.ownerSlug,
    ).toBe('center-equity');
  });

  it('leaves a cleared row alone when nothing would re-promote an organization page', () => {
    const clearedRow = personRow('', {
      website: '',
      sourceUrls: ['https://example.edu/demo-school/profile/ada-lovelace/'],
    });
    expect(
      planOrganizationIdentityWebsiteGraft(clearedRow, organizations, resolveAliases),
    ).toBeNull();
  });

  it('refuses a row that is not person-scoped', () => {
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow(CENTER_VANITY, { entityType: 'CENTER', kind: 'center', slug: 'center-other' }),
        organizations,
        resolveAliases,
      ),
    ).toBeNull();
  });

  it('refuses a manually locked website slot', () => {
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow(CENTER_VANITY, { manuallyLockedFields: ['websiteUrl'] }),
        organizations,
        resolveAliases,
      ),
    ).toBeNull();
  });

  it('plans nothing once the value is refused, which is what makes a second run a no-op', () => {
    const refusedRow = personRow(CENTER_VANITY, {
      fieldValueRefusals: {
        websiteUrl: [
          {
            valueKey: fieldValueRefusalKey('websiteUrl', CENTER_VANITY),
            rule: 'wrong_owner',
            refusedBy: 'observations:retire-organization-identity-websites',
            refusedAt: new Date('2020-01-01T00:00:00.000Z'),
            note: 'the organization owns this page',
          },
        ],
      },
    });
    expect(
      planOrganizationIdentityWebsiteGraft(refusedRow, organizations, resolveAliases),
    ).toBeNull();
  });

  it('still plans when the refusal names a different value, so one refusal is not a field lock', () => {
    const refusedRow = personRow(CENTER_VANITY, {
      fieldValueRefusals: {
        websiteUrl: [
          {
            valueKey: fieldValueRefusalKey('websiteUrl', 'https://example.edu/unrelated-page/'),
            rule: 'wrong_owner',
            refusedBy: 'observations:retire-organization-identity-websites',
            refusedAt: new Date('2020-01-01T00:00:00.000Z'),
            note: 'a different page entirely',
          },
        ],
      },
    });
    expect(
      planOrganizationIdentityWebsiteGraft(refusedRow, organizations, resolveAliases),
    ).not.toBeNull();
  });

  it('plans again once the refusal is withdrawn, which a lock could never allow', () => {
    const withdrawnRow = personRow(CENTER_VANITY, {
      fieldValueRefusals: {
        websiteUrl: [
          {
            valueKey: fieldValueRefusalKey('websiteUrl', CENTER_VANITY),
            rule: 'wrong_owner',
            refusedBy: 'observations:retire-organization-identity-websites',
            refusedAt: new Date('2020-01-01T00:00:00.000Z'),
            note: 'the organization owns this page',
            withdrawnAt: new Date('2020-02-01T00:00:00.000Z'),
            withdrawnReason: 'the owner row was archived',
          },
        ],
      },
    });
    expect(
      planOrganizationIdentityWebsiteGraft(withdrawnRow, organizations, resolveAliases),
    ).not.toBeNull();
  });

  it('refuses the organization row itself', () => {
    expect(
      planOrganizationIdentityWebsiteGraft(
        personRow(CENTER_CANONICAL, { slug: 'center-equity' }),
        organizations,
        resolveAliases,
      ),
    ).toBeNull();
  });

  it('refuses when nothing resolved, rather than comparing unresolved strings', () => {
    expect(
      planOrganizationIdentityWebsiteGraft(personRow(CENTER_VANITY), organizations, () => ''),
    ).toBeNull();
  });
});

describe('urlsToResolve', () => {
  it('collects each candidate website and its matching organization website once', () => {
    const rows = [personRow(CENTER_VANITY), personRow(CENTER_LEGACY_PATH), personRow('')];
    expect(urlsToResolve(rows, organizations).sort()).toEqual(
      [CENTER_CANONICAL, CENTER_LEGACY_PATH, CENTER_VANITY].sort(),
    );
  });

  it('skips a row whose token matches no organization', () => {
    expect(urlsToResolve([personRow('https://example.edu/unrelated/')], organizations)).toEqual([]);
  });

  it('skips a locked row, which the planner refuses after the probe', () => {
    const lockedRow = personRow(CENTER_VANITY, { manuallyLockedFields: ['websiteUrl'] });
    expect(
      planOrganizationIdentityWebsiteGraft(lockedRow, organizations, resolveAliases),
    ).toBeNull();
    expect(urlsToResolve([lockedRow], organizations)).toEqual([]);
  });
});

describe('isOrganizationIdentityWebsiteObservation', () => {
  const plan = planOrganizationIdentityWebsiteGraft(
    personRow(CENTER_VANITY),
    organizations,
    resolveAliases,
  )!;

  it('matches the assertion that put the page in the slot', () => {
    expect(
      isOrganizationIdentityWebsiteObservation('websiteUrl', CENTER_VANITY, plan, resolveAliases),
    ).toBe(true);
  });

  it('matches the paired website-field assertion carrying the same value', () => {
    expect(
      isOrganizationIdentityWebsiteObservation('website', CENTER_VANITY, plan, resolveAliases),
    ).toBe(true);
  });

  it('matches a runner-up assertion that resolves to the same page', () => {
    expect(
      isOrganizationIdentityWebsiteObservation(
        'websiteUrl',
        CENTER_CANONICAL,
        plan,
        resolveAliases,
      ),
    ).toBe(true);
    expect(
      isOrganizationIdentityWebsiteObservation(
        'websiteUrl',
        CENTER_LEGACY_PATH,
        plan,
        resolveAliases,
      ),
    ).toBe(true);
  });

  it('refuses a field that cannot fill the website slot', () => {
    expect(
      isOrganizationIdentityWebsiteObservation('sourceUrls', CENTER_VANITY, plan, resolveAliases),
    ).toBe(false);
  });

  it('refuses an assertion for a different page, and a non-string value', () => {
    expect(
      isOrganizationIdentityWebsiteObservation(
        'websiteUrl',
        'https://example.edu/unrelated/',
        plan,
        resolveAliases,
      ),
    ).toBe(false);
    expect(
      isOrganizationIdentityWebsiteObservation('websiteUrl', [CENTER_VANITY], plan, () => ''),
    ).toBe(false);
  });
});

describe('ownerNameDenotesOrganization', () => {
  it('accepts an umbrella-named organization and a shared facility', () => {
    expect(ownerNameDenotesOrganization('Fixture Equity Center')).toBe(true);
    expect(ownerNameDenotesOrganization('Fixture CryoEM Resource')).toBe(true);
  });

  it('refuses a person-scoped row wearing an organizational entityType', () => {
    expect(ownerNameDenotesOrganization('Lovelace Lab')).toBe(false);
    expect(ownerNameDenotesOrganization('Ada Lovelace Faculty Research')).toBe(false);
    expect(ownerNameDenotesOrganization('')).toBe(false);
  });
});
