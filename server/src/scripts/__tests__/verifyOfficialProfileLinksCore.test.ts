import { describe, expect, it } from 'vitest';
import {
  isDecisivelyDeadProbe,
  isDecisivelyLiveProbe,
  isRetryableProbe,
  officialProfileLinkCandidates,
  officialProfileLinkHost,
  probeRetryDelayMs,
  profileSlugNamesPerson,
  settledHealthStatusFor,
  storedHealthStatusFor,
  summarizeDepartmentLinkHealth,
  type OfficialProfileLinkRow,
  isProfileLinkDueForVerification,
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

  it('follows a department that publishes the person under a nickname', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/profile/phil-example',
        'Philip Example',
      ),
    ).toBe(true);
  });

  it('reads the person slug out of a /person/ path', () => {
    expect(
      profileSlugNamesPerson('https://example-dept.yale.edu/person/dana-example/', 'Dana Example'),
    ).toBe(true);
  });

  it('reads the person slug out of a section-nested people path', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/people/full-part-time-lecturers/dana-example',
        'Dana Example',
      ),
    ).toBe(true);
  });

  it('still refuses a section-nested roster page that names no person', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/people/ladder-faculty',
        'Ladder Faculty',
      ),
    ).toBe(false);
  });

  it('refuses a same-surname colleague whose given name merely shares a prefix', () => {
    expect(
      profileSlugNamesPerson('https://example-dept.yale.edu/profile/sara-example', 'Sarah Example'),
    ).toBe(false);
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/profile/alex-example',
        'Alexandra Example',
      ),
    ).toBe(false);
  });

  it('reads the nested CMS profile page a department publishes under a section', () => {
    expect(
      profileSlugNamesPerson(
        'https://medicine.yale.edu/lab-example/profile/dana-example',
        'Dana Example',
      ),
    ).toBe(true);
  });

  it('refuses a nested person page whose slug names someone else', () => {
    expect(
      profileSlugNamesPerson(
        'https://example-dept.yale.edu/person/casey-example/',
        'William Example',
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
      'https://example-dept.yale.edu/people/a-douglas-example',
    ]);
  });

  it('never proposes a same-surname colleague page for an initial-led display name', () => {
    expect(
      officialProfileLinkCandidates(
        'https://example-dept.yale.edu/people/douglas-example',
        'A Douglas Example',
        ['https://example-dept.yale.edu/profile/alison-example'],
      ),
    ).toEqual([
      'https://example-dept.yale.edu/profile/douglas-example',
      'https://example-dept.yale.edu/profile/a-douglas-example',
      'https://example-dept.yale.edu/people/a-douglas-example',
    ]);
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
    ).toEqual([
      'https://medicine.yale.edu/profile/ada-example',
      'https://medicine.yale.edu/people/ada-example',
    ]);
  });

  it('offers the reverse-section twin of a dead slug the display name cannot reproduce', () => {
    expect(
      officialProfileLinkCandidates('https://ysph.yale.edu/profile/dana-l-example', 'Dana Example'),
    ).toEqual([
      'https://ysph.yale.edu/people/dana-l-example',
      'https://ysph.yale.edu/profile/dana-example',
      'https://ysph.yale.edu/people/dana-example',
    ]);
  });

  it('never mints a roster page from a display name that leaked a roster label', () => {
    expect(
      officialProfileLinkCandidates(
        'https://medicine.yale.edu/people/ada-example',
        'Primary Faculty',
      ),
    ).toEqual(['https://medicine.yale.edu/profile/ada-example']);
  });

  it('never mints a candidate from a display name carrying no surname', () => {
    expect(
      officialProfileLinkCandidates('https://medicine.yale.edu/profile/ada-example', 'Example'),
    ).toEqual([]);
  });

  it('excludes another host and the dead path, but still offers the reverse-section page', () => {
    expect(
      officialProfileLinkCandidates(
        'https://example-dept.yale.edu/profile/ada-example',
        'Ada Example',
        [
          'https://other-dept.yale.edu/profile/ada-example',
          'https://example-dept.yale.edu/profile/ada-example/',
        ],
      ),
    ).toEqual(['https://example-dept.yale.edu/people/ada-example']);
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

describe('isRetryableProbe', () => {
  it('retries a throttle or a server-side failure', () => {
    for (const httpStatusCode of [403, 408, 429, 500, 503]) {
      expect(isRetryableProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode })).toBe(true);
    }
    expect(isRetryableProbe({ healthStatus: 'UNKNOWN' })).toBe(true);
    expect(isRetryableProbe(undefined)).toBe(true);
  });

  it('never retries an answer that already settled the link', () => {
    expect(isRetryableProbe({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe(false);
    expect(isRetryableProbe({ healthStatus: 'REDIRECTED', httpStatusCode: 301 })).toBe(false);
    expect(isRetryableProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 })).toBe(false);
    expect(isRetryableProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode: 410 })).toBe(false);
  });

  it('does not retry a 401, which is a decision rather than a throttle', () => {
    expect(isRetryableProbe({ healthStatus: 'UNAVAILABLE', httpStatusCode: 401 })).toBe(false);
  });
});

describe('probeRetryDelayMs', () => {
  it('backs off geometrically from the first retry', () => {
    expect(probeRetryDelayMs(1, 2000)).toBe(2000);
    expect(probeRetryDelayMs(2, 2000)).toBe(4000);
    expect(probeRetryDelayMs(3, 2000)).toBe(8000);
  });
});

describe('isProfileLinkDueForVerification', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  // `--limit` truncates the head of a stable read order, so without this filter a
  // bounded run re-probed the same first N links every time and the tail was
  // permanently unreachable rather than merely sampled (#3222).
  it('is always due when no staleness window is asked for, preserving the old behaviour', () => {
    expect(isProfileLinkDueForVerification(daysAgo(0), 0, now)).toBe(true);
    expect(isProfileLinkDueForVerification(undefined, 0, now)).toBe(true);
  });

  it('skips a decisively judged link inside the window and takes one that has aged out', () => {
    expect(isProfileLinkDueForVerification(daysAgo(29), 30, now, 'HEALTHY')).toBe(false);
    expect(isProfileLinkDueForVerification(daysAgo(29), 30, now, 'UNAVAILABLE')).toBe(false);
    expect(isProfileLinkDueForVerification(daysAgo(30), 30, now, 'HEALTHY')).toBe(true);
    expect(isProfileLinkDueForVerification(daysAgo(31), 30, now, 'HEALTHY')).toBe(true);
  });

  // The defect the window itself introduced: a link probed yesterday that came back
  // 403 carries a fresh verifiedAt and a stored UNKNOWN, which is the absence of a
  // verdict. Age-only, a 30-day window on the largest host reported 0 links due
  // while 439 corpus-wide held no decisive status at all.
  it('takes a recently probed link that still holds no decisive verdict', () => {
    expect(isProfileLinkDueForVerification(daysAgo(1), 30, now, 'UNKNOWN')).toBe(true);
    expect(isProfileLinkDueForVerification(daysAgo(1), 30, now, undefined)).toBe(true);
  });

  // The never-probed population is the whole point of the lane, so it must never be
  // what a bounded run skips.
  it('treats a link with no usable verifiedAt as due', () => {
    expect(isProfileLinkDueForVerification(undefined, 30, now, 'HEALTHY')).toBe(true);
    expect(isProfileLinkDueForVerification(null, 30, now, 'HEALTHY')).toBe(true);
    expect(isProfileLinkDueForVerification('not a date', 30, now, 'HEALTHY')).toBe(true);
  });

  it('accepts an ISO string as well as a Date, which is what a lean read returns', () => {
    expect(isProfileLinkDueForVerification(daysAgo(40).toISOString(), 30, now, 'HEALTHY')).toBe(
      true,
    );
    expect(isProfileLinkDueForVerification(daysAgo(2).toISOString(), 30, now, 'HEALTHY')).toBe(
      false,
    );
  });
});

describe('an unsettled link backs off instead of blocking the next pass (#3303)', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  /**
   * The signature this fixes: a throttled probe writes no status, so the link stays
   * UNKNOWN, was always due, and every run re-probed the same links in the same order and
   * stopped at the same wall. Identical counts across runs was the visible symptom.
   */
  it('defers a link probed an hour ago that did not settle', () => {
    expect(isProfileLinkDueForVerification(hoursAgo(1), 7, now, 'UNKNOWN', 6)).toBe(false);
  });

  it('makes it due again once the window passes, so nothing is masked permanently', () => {
    expect(isProfileLinkDueForVerification(hoursAgo(7), 7, now, 'UNKNOWN', 6)).toBe(true);
  });

  it('always probes a link never attempted, whatever the window', () => {
    expect(isProfileLinkDueForVerification(undefined, 7, now, 'UNKNOWN', 6)).toBe(true);
    expect(isProfileLinkDueForVerification('', 7, now, undefined, 6)).toBe(true);
  });

  it('keeps the old behaviour when the window is switched off', () => {
    expect(isProfileLinkDueForVerification(hoursAgo(1), 7, now, 'UNKNOWN', 0)).toBe(true);
  });

  /**
   * A settled verdict is still governed by staleAfterDays, not by the attempt window:
   * the back-off must not shorten how long a real verdict is trusted.
   */
  it('leaves a settled verdict on the staleness rule', () => {
    expect(isProfileLinkDueForVerification(hoursAgo(24), 7, now, 'HEALTHY', 6)).toBe(false);
    expect(isProfileLinkDueForVerification(hoursAgo(24 * 8), 7, now, 'HEALTHY', 6)).toBe(true);
    expect(isProfileLinkDueForVerification(hoursAgo(24 * 8), 7, now, 'UNAVAILABLE', 6)).toBe(true);
  });

  it('still probes everything when staleAfterDays is 0', () => {
    expect(isProfileLinkDueForVerification(hoursAgo(1), 0, now, 'UNKNOWN', 6)).toBe(true);
  });
});
