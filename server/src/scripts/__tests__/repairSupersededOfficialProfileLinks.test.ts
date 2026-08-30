import { describe, expect, it } from 'vitest';
import { supersedesOfficialProfileUrl } from '../backfillResearcherOfficialProfileLinksCore';
import {
  canonicalOfficialProfileUrlKey,
  planSupersededOfficialProfileLinkRepair,
} from '../repairSupersededOfficialProfileLinksCore';

describe('supersedesOfficialProfileUrl', () => {
  it('accepts a same-host move from a directory path onto the CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(true);
  });

  it('never moves back off the CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/people/ada-example',
      ),
    ).toBe(false);
  });

  it('leaves a link from another host alone', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://other-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('treats two CMS profile pages on one host as no change', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/profile/ada-example-2',
      ),
    ).toBe(false);
  });

  it('ignores an identical path that differs only by trailing slash', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example/',
        'https://example-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('ignores non-Yale and unparseable candidates', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example.com/profile/ada-example',
      ),
    ).toBe(false);
    expect(supersedesOfficialProfileUrl('not a url', 'also not a url')).toBe(false);
  });
});

describe('canonicalOfficialProfileUrlKey', () => {
  it('normalizes host case and the trailing slash', () => {
    expect(
      canonicalOfficialProfileUrlKey('https://Example-Dept.YALE.edu/profile/Ada-Example/'),
    ).toBe('https://example-dept.yale.edu/profile/ada-example');
  });

  it('rejects a non-Yale host', () => {
    expect(
      canonicalOfficialProfileUrlKey('https://example.com/profile/ada-example'),
    ).toBeUndefined();
  });
});

describe('planSupersededOfficialProfileLinkRepair', () => {
  const staleLink = {
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url: 'https://example-dept.yale.edu/people/ada-example',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    healthStatus: 'UNKNOWN' as const,
  };

  it('repairs a stale link whose CMS profile twin was observed', () => {
    const row = planSupersededOfficialProfileLinkRepair(
      { id: 'r1', displayName: 'Ada Example', profileLinks: [staleLink] },
      new Set(['https://example-dept.yale.edu/profile/ada-example']),
    );
    expect(row).toEqual({
      id: 'r1',
      displayName: 'Ada Example',
      before: 'https://example-dept.yale.edu/people/ada-example',
      after: 'https://example-dept.yale.edu/profile/ada-example',
    });
  });

  it('leaves a stale link alone when no source published the profile twin', () => {
    expect(
      planSupersededOfficialProfileLinkRepair(
        { id: 'r1', profileLinks: [staleLink] },
        new Set(['https://other-dept.yale.edu/profile/ada-example']),
      ),
    ).toBeUndefined();
  });

  it('ignores links of other kinds', () => {
    expect(
      planSupersededOfficialProfileLinkRepair(
        {
          id: 'r1',
          profileLinks: [{ ...staleLink, kind: 'PERSONAL_ACADEMIC' as const }],
        },
        new Set(['https://example-dept.yale.edu/profile/ada-example']),
      ),
    ).toBeUndefined();
  });

  it('leaves an already-canonical link alone', () => {
    expect(
      planSupersededOfficialProfileLinkRepair(
        {
          id: 'r1',
          profileLinks: [
            { ...staleLink, url: 'https://example-dept.yale.edu/profile/ada-example' },
          ],
        },
        new Set(['https://example-dept.yale.edu/profile/ada-example']),
      ),
    ).toBeUndefined();
  });
});
