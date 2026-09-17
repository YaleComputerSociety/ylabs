import { describe, expect, it } from 'vitest';
import {
  classifyRosterLane,
  classifySiblingTabKind,
  laneUrlIdentityKey,
  redirectLandedDeeper,
  siblingPeopleTabUrls,
  siblingTabFacultyGapKeys,
  summarizeRosterLaneAudit,
  uncoveredSiblingTabs,
  type RosterLaneEvidence,
} from '../auditRosterLanesCore';

const laneEvidence = (overrides: Partial<RosterLaneEvidence> = {}): RosterLaneEvidence => ({
  deptKey: 'example',
  deptName: 'Example Studies',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: 'https://example.yale.edu/people',
  paginated: false,
  reachability: 'HEALTHY',
  httpStatusCode: 200,
  peopleRead: 24,
  rowsRead: 24,
  pagesFetched: 1,
  pagerStopReason: 'not-paginated',
  jsRendered: false,
  uncoveredSiblingTabUrls: [],
  ...overrides,
});

describe('laneUrlIdentityKey', () => {
  it('folds scheme, www, case and a trailing slash', () => {
    expect(laneUrlIdentityKey('https://WWW.Example.yale.edu/People/')).toBe(
      laneUrlIdentityKey('http://example.yale.edu/people'),
    );
  });
});

describe('redirectLandedDeeper', () => {
  it('reports a people root landing on one tab of a tabbed roster', () => {
    expect(
      redirectLandedDeeper(
        'https://example.yale.edu/people',
        'https://example.yale.edu/people/core-faculty',
      ),
    ).toBe(true);
  });

  it('ignores a scheme upgrade or a trailing-slash change', () => {
    expect(
      redirectLandedDeeper('http://example.yale.edu/people', 'https://example.yale.edu/people/'),
    ).toBe(false);
  });

  it('ignores a redirect to a different host', () => {
    expect(
      redirectLandedDeeper(
        'https://example.yale.edu/people',
        'https://other.yale.edu/people/faculty',
      ),
    ).toBe(false);
  });

  it('ignores a sibling path that is not deeper', () => {
    expect(
      redirectLandedDeeper('https://example.yale.edu/people', 'https://example.yale.edu/directory'),
    ).toBe(false);
  });
});

describe('siblingPeopleTabUrls', () => {
  const html = `
    <a href="/people/core-faculty">Core Faculty</a>
    <a href="/people/emeriti">Emeriti</a>
    <a href="/people/graduate-students">Graduate Students</a>
    <a href="/people/staff">Staff</a>
    <a href="/people/core-faculty/example-person">A person</a>
    <a href="/research">Research</a>
    <a href="https://other.yale.edu/people/faculty">Another department</a>
  `;

  it('returns every people-listing tab one level below the people root', () => {
    // Whether a listing holds FACULTY is decided from its rows by
    // `siblingTabFacultyGapKeys`, not from its slug, so `/people/staff` is a
    // candidate here and is dropped later.
    expect(siblingPeopleTabUrls(html, 'https://example.yale.edu/people')).toEqual([
      'https://example.yale.edu/people/core-faculty',
      'https://example.yale.edu/people/emeriti',
      'https://example.yale.edu/people/staff',
    ]);
  });

  it('excludes a nested profile, a non-people path and another host', () => {
    const found = siblingPeopleTabUrls(html, 'https://example.yale.edu/people');
    expect(found).not.toContain('https://example.yale.edu/people/core-faculty/example-person');
    expect(found).not.toContain('https://example.yale.edu/research');
    expect(found.some((url) => url.includes('other.yale.edu'))).toBe(false);
  });

  it('excludes a person published directly under the people root', () => {
    // economics.yale.edu publishes individuals at `/people/<name>`, so a
    // depth-only rule reported 12 person profiles as uncovered tabs.
    const peopleRootProfiles = `
      <a href="/people/ada-example">Ada Example</a>
      <a href="/people/bo-sample">Bo Sample</a>
      <a href="/people/ladder-faculty">Ladder Faculty</a>
    `;
    expect(siblingPeopleTabUrls(peopleRootProfiles, 'https://economics.yale.edu/people')).toEqual([
      'https://economics.yale.edu/people/ladder-faculty',
    ]);
  });

  it('returns nothing when the page is not under a people root', () => {
    expect(siblingPeopleTabUrls(html, 'https://example.yale.edu/about')).toEqual([]);
  });
});

describe('uncoveredSiblingTabs', () => {
  it('treats a tab another config already reads as covered', () => {
    expect(
      uncoveredSiblingTabs(
        ['https://example.yale.edu/people/core-faculty', 'https://example.yale.edu/people/emeriti'],
        ['https://example.yale.edu/people/core-faculty/'],
      ),
    ).toEqual(['https://example.yale.edu/people/emeriti']);
  });
});

describe('siblingTabFacultyGapKeys', () => {
  const professor = { title: 'Professor of Physics', identityKey: 'url:/p/prof' };
  const postdoc = { title: 'Postdoctoral Associate', identityKey: 'url:/p/postdoc' };
  const staff = { title: 'Department Registrar', identityKey: 'url:/p/registrar' };

  it('reports a professor no lane on the host read', () => {
    expect(siblingTabFacultyGapKeys([professor], new Set())).toEqual(['url:/p/prof']);
  });

  it('drops an alias tab whose professors are already read', () => {
    // medieval.yale.edu/people/faculty serves the same people as /people/core-faculty.
    expect(siblingTabFacultyGapKeys([professor], new Set(['url:/p/prof']))).toEqual([]);
  });

  it('drops a postdoc and staff tab, which is not a faculty gap', () => {
    // The first version of this audit used a slug denylist and reported 91 such
    // tabs across 40 lanes, nearly all postdocs, lecturers and research staff.
    expect(siblingTabFacultyGapKeys([postdoc, staff], new Set())).toEqual([]);
  });

  it('reports only the faculty rows on a mixed tab', () => {
    expect(siblingTabFacultyGapKeys([professor, postdoc, staff], new Set())).toEqual([
      'url:/p/prof',
    ]);
  });

  it('drops a row with no stated title, since an absent rank is not a faculty claim', () => {
    expect(siblingTabFacultyGapKeys([{ identityKey: 'url:/p/unknown' }], new Set())).toEqual([]);
  });
});

describe('classifyRosterLane', () => {
  it('passes a lane that read its roster on one page', () => {
    expect(classifyRosterLane(laneEvidence()).verdict).toBe('ok');
  });

  it('separates a blocked fetch from an empty page', () => {
    const blocked = classifyRosterLane(
      laneEvidence({ reachability: 'UNAVAILABLE', httpStatusCode: 403, peopleRead: 0 }),
    );
    expect(blocked.verdict).toBe('unreachable');

    const empty = classifyRosterLane(
      laneEvidence({ reachability: 'HEALTHY', httpStatusCode: 200, peopleRead: 0 }),
    );
    expect(empty.verdict).toBe('dead-extractor');
  });

  it('separates a thrown extractor from an unreachable page', () => {
    const finding = classifyRosterLane(
      laneEvidence({
        reachability: 'HEALTHY',
        httpStatusCode: 200,
        peopleRead: 0,
        pagerStopReason: 'extractor-error',
        error: 'selector gone',
      }),
    );
    expect(finding.verdict).toBe('extractor-error');
    expect(finding.detail).toContain('selector gone');
  });

  it('declines to judge a JS-rendered lane rather than calling it unreachable', () => {
    // The six SEAS lanes use a stub extractor that throws by design, and reading
    // that throw as a verdict called six healthy lanes unreachable.
    const finding = classifyRosterLane(
      laneEvidence({
        jsRendered: true,
        peopleRead: 0,
        pagerStopReason: 'extractor-error',
        error: 'Yale CS faculty page is JS-rendered; needs headless browser',
      }),
    );
    expect(finding.verdict).toBe('js-rendered-not-audited');
  });

  it('reports a pager that ran to its cap without terminating', () => {
    const finding = classifyRosterLane(
      laneEvidence({
        paginated: true,
        pagesFetched: 20,
        pagerStopReason: 'page-cap',
        peopleRead: 97,
        rowsRead: 400,
      }),
    );
    expect(finding.verdict).toBe('pager-never-terminated');
  });

  it('accepts a pager that stopped on a repeated page', () => {
    expect(
      classifyRosterLane(
        laneEvidence({ paginated: true, pagesFetched: 4, pagerStopReason: 'repeated-page' }),
      ).verdict,
    ).toBe('ok');
  });

  it('reports the most severe finding when a lane has several', () => {
    const finding = classifyRosterLane(
      laneEvidence({
        reachability: 'UNAVAILABLE',
        peopleRead: 0,
        pagerStopReason: 'page-cap',
        uncoveredSiblingTabUrls: ['https://example.yale.edu/people/emeriti'],
      }),
    );
    expect(finding.verdict).toBe('unreachable');
    expect(finding.detail).toContain('sibling tab');
  });
});

describe('summarizeRosterLaneAudit', () => {
  it('counts verdicts, sorts findings first and totals redundant rows', () => {
    const report = summarizeRosterLaneAudit([
      laneEvidence({ deptKey: 'clean' }),
      laneEvidence({
        deptKey: 'wasteful',
        paginated: true,
        pagerStopReason: 'page-cap',
        pagesFetched: 20,
        peopleRead: 97,
        rowsRead: 1940,
      }),
    ]);

    expect(report.status).toBe('findings');
    expect(report.brokenLanes).toBe(1);
    expect(report.lanesAudited).toBe(2);
    expect(report.lanes[0]!.deptKey).toBe('wasteful');
    expect(report.verdictCounts['pager-never-terminated']).toBe(1);
    expect(report.verdictCounts.ok).toBe(1);
    expect(report.redundantRowsRead).toBe(1843);
    expect(report.peopleRead).toBe(121);
  });

  it('does not alarm on coverage debt alone', () => {
    // 32 of 118 lanes owe sibling-tab debt; alarming on it trains people to
    // ignore the exit code, so only a broken lane fails the run.
    const report = summarizeRosterLaneAudit([
      laneEvidence({
        uncoveredSiblingTabUrls: ['https://example.yale.edu/people/emeritus-faculty'],
      }),
    ]);
    expect(report.status).toBe('ok');
    expect(report.brokenLanes).toBe(0);
    expect(report.verdictCounts['uncovered-sibling-tab']).toBe(1);
    expect(report.siblingTabsByKind.emeritus).toBe(1);
  });

  it('reports ok when every lane passes', () => {
    const report = summarizeRosterLaneAudit([laneEvidence(), laneEvidence({ deptKey: 'other' })]);
    expect(report.status).toBe('ok');
  });
});

describe('classifySiblingTabKind', () => {
  it('ranks a tab by what kind of faculty it lists', () => {
    expect(classifySiblingTabKind('https://x.yale.edu/people/emeritus-faculty')).toBe('emeritus');
    expect(classifySiblingTabKind('https://x.yale.edu/people/affiliated-faculty')).toBe(
      'affiliated',
    );
    expect(classifySiblingTabKind('https://x.yale.edu/people/secondary-faculty')).toBe(
      'affiliated',
    );
    expect(classifySiblingTabKind('https://x.yale.edu/people/lecturers')).toBe('teaching-track');
    expect(classifySiblingTabKind('https://x.yale.edu/people/gibbs-assistant-professors')).toBe(
      'teaching-track',
    );
    expect(classifySiblingTabKind('https://x.yale.edu/people/faculty/')).toBe('primary');
  });
});
