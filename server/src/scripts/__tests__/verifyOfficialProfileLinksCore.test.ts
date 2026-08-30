import { describe, expect, it } from 'vitest';
import {
  isDecisivelyDeadProbe,
  isDecisivelyLiveProbe,
  officialProfileLinkCandidates,
  officialProfileLinkHost,
  profileSlugNamesPerson,
  settledHealthStatusFor,
  storedHealthStatusFor,
  summarizeDepartmentLinkHealth,
  type OfficialProfileLinkRow,
} from '../verifyOfficialProfileLinksCore';
import { isServableOfficialProfileLink } from '../../utils/officialProfileLinkServability';

describe('probe decisiveness', () => {
  it('treats 404 and 410 as decisively dead', () => {
    expect(isDecisivelyDeadProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 })).toBe(true);
    expect(isDecisivelyDeadProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode: 410 })).toBe(true);
  });

  it('refuses to call a bot-blocked or overloaded department site dead', () => {
    for (const httpStatusCode of [401, 403, 429, 500, 503]) {
      expect(isDecisivelyDeadProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode })).toBe(false);
    }
  });

  it('refuses to call a transport failure dead', () => {
    expect(isDecisivelyDeadProbe({ healthStatus: 'UNAVAILABLE' })).toBe(false);
    expect(isDecisivelyDeadProbe({ healthStatus: 'UNKNOWN' })).toBe(false);
    expect(isDecisivelyDeadProbe(undefined)).toBe(false);
  });

  it('counts a 2xx or a redirect that resolved as live', () => {
    expect(isDecisivelyLiveProbe({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe(true);
    expect(isDecisivelyLiveProbe({ healthStatus: 'REDIRECTED', httpStatusCode: 301 })).toBe(true);
    expect(isDecisivelyLiveProbe({ healthStatus: 'UNKNOWN' })).toBe(false);
  });
});

describe('storedHealthStatusFor', () => {
  it('records only what the probe settled', () => {
    expect(storedHealthStatusFor({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe('HEALTHY');
    expect(storedHealthStatusFor({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 })).toBe(
      'UNAVAILABLE',
    );
    expect(storedHealthStatusFor({ healthStatus: 'UNAVAILABLE', httpStatusCode: 403 })).toBe(
      'UNKNOWN',
    );
    expect(storedHealthStatusFor(undefined)).toBe('UNKNOWN');
  });
});

describe('settledHealthStatusFor', () => {
  it('offers a status to write only when the probe settled one', () => {
    expect(settledHealthStatusFor({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe(
      'HEALTHY',
    );
    expect(settledHealthStatusFor({ healthStatus: 'UNAVAILABLE', httpStatusCode: 410 })).toBe(
      'UNAVAILABLE',
    );
  });

  it('offers nothing for a bot-blocked, overloaded, or unreachable department site', () => {
    expect(
      settledHealthStatusFor({ healthStatus: 'UNAVAILABLE', httpStatusCode: 403 }),
    ).toBeUndefined();
    expect(
      settledHealthStatusFor({ healthStatus: 'UNAVAILABLE', httpStatusCode: 503 }),
    ).toBeUndefined();
    expect(settledHealthStatusFor({ healthStatus: 'UNKNOWN' })).toBeUndefined();
    expect(settledHealthStatusFor(undefined)).toBeUndefined();
  });
});

describe('officialProfileLinkHost', () => {
  it('accepts a Yale host and rejects anything else', () => {
    expect(officialProfileLinkHost('https://Classics.YALE.edu/people/ada-example')).toBe(
      'classics.yale.edu',
    );
    expect(officialProfileLinkHost('https://example.com/people/ada-example')).toBeUndefined();
    expect(officialProfileLinkHost('not a url')).toBeUndefined();
  });
});

describe('profileSlugNamesPerson', () => {
  it('follows a re-slug that adds a leading initial', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/profile/a-dana-example',
        'A Dana Example',
      ),
    ).toBe(true);
  });

  it('follows a re-slug that drops a middle initial', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/profile/dana-example',
        'Dana L. Example',
      ),
    ).toBe(true);
  });

  it('refuses a colleague who only shares the surname', () => {
    expect(
      profileSlugNamesPerson('https://example-dept.yale.edu/profile/robin-example', 'Dana Example'),
    ).toBe(false);
  });

  it('refuses a same-surname colleague whose given name merely starts with a leading initial', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/profile/alison-example',
        'A Douglas Example',
      ),
    ).toBe(false);
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/profile/dana-example',
        'D Robin Example',
      ),
    ).toBe(false);
  });

  it('refuses a different surname and a roster page', () => {
    expect(
      profileSlugNamesPerson('https://example-dept.yale.edu/profile/dana-other', 'Dana Example'),
    ).toBe(false);
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/people/primary-faculty',
        'Dana Example',
      ),
    ).toBe(false);
  });
});

describe('officialProfileLinkCandidates', () => {
  it('puts an observed same-slug URL ahead of the constructed twin', () => {
    expect(
      officialProfileLinkCandidates(
        'https://example-dept.yale.edu/people/ada-example',
        'Ada Example',
        ['https://example-dept.yale.edu/faculty/ada-example'],
      ),
    ).toEqual([
      'https://example-dept.yale.edu/faculty/ada-example',
      'https://example-dept.yale.edu/profile/ada-example',
    ]);
  });

  it('offers an observed re-slugged page for the same person', () => {
    expect(
      officialProfileLinkCandidates(
        'https://example-dept.yale.edu/people/douglas-example',
        'A Douglas Example',
        [
          'https://example-dept.yale.edu/profile/a-douglas-example',
          'https://example-dept.yale.edu/profile/robin-other',
        ],
      ),
    ).toEqual([
      'https://example-dept.yale.edu/profile/a-douglas-example',
      'https://example-dept.yale.edu/profile/douglas-example',
    ]);
  });

  it('never proposes a same-surname colleague page for an initial-led display name', () => {
    expect(
      officialProfileLinkCandidates(
        'https://example-dept.yale.edu/people/douglas-example',
        'A Douglas Example',
        ['https://example-dept.yale.edu/profile/alison-example'],
      ),
    ).toEqual(['https://example-dept.yale.edu/profile/douglas-example']);
  });

  it('offers the constructed twin when nothing was observed', () => {
    expect(
      officialProfileLinkCandidates(
        'https://classics.yale.edu/people/egbert-example',
        'Egbert Example',
      ),
    ).toEqual(['https://classics.yale.edu/profile/egbert-example']);
  });

  it('keeps the slug of a lab-mirror path', () => {
    expect(
      officialProfileLinkCandidates(
        'https://medicine.yale.edu/lab/example/profile/ada-example/',
        'Ada Example',
      ),
    ).toEqual(['https://medicine.yale.edu/profile/ada-example']);
  });

  it('never proposes a different host or the dead path itself', () => {
    expect(
      officialProfileLinkCandidates(
        'https://example-dept.yale.edu/profile/ada-example',
        'Ada Example',
        [
          'https://other-dept.yale.edu/profile/ada-example',
          'https://example-dept.yale.edu/profile/ada-example/',
        ],
      ),
    ).toEqual([]);
  });
});

describe('summarizeDepartmentLinkHealth', () => {
  const row = (
    host: string,
    verdict: OfficialProfileLinkRow['verdict'],
  ): OfficialProfileLinkRow => ({
    researcherId: `${host}-${verdict}`,
    host,
    url: `https://${host}/people/ada-example`,
    verdict,
  });

  it('groups by department and ranks the hosts needing attention first', () => {
    const summaries = summarizeDepartmentLinkHealth([
      row('healthy-dept.yale.edu', 'healthy'),
      row('healthy-dept.yale.edu', 'healthy'),
      row('healthy-dept.yale.edu', 'healthy'),
      row('migrated-dept.yale.edu', 'repaired'),
      row('migrated-dept.yale.edu', 'dead'),
    ]);
    expect(summaries.map((summary) => summary.host)).toEqual([
      'migrated-dept.yale.edu',
      'healthy-dept.yale.edu',
    ]);
    expect(summaries[0]).toEqual({
      host: 'migrated-dept.yale.edu',
      total: 2,
      healthy: 0,
      repaired: 1,
      dead: 1,
      inconclusive: 0,
    });
  });
});

describe('isServableOfficialProfileLink', () => {
  const link = (healthStatus: 'HEALTHY' | 'UNAVAILABLE' | 'UNKNOWN') => ({
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url: 'https://example-dept.yale.edu/profile/ada-example',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    healthStatus,
  });

  it('withholds a link the lane proved gone', () => {
    expect(isServableOfficialProfileLink(link('UNAVAILABLE'))).toBe(false);
  });

  it('still serves a healthy or unprobed link', () => {
    expect(isServableOfficialProfileLink(link('HEALTHY'))).toBe(true);
    expect(isServableOfficialProfileLink(link('UNKNOWN'))).toBe(true);
  });
});
