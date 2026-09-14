import { describe, it, expect } from 'vitest';
import {
  buildLabSiteLeadVerification,
  contestedSurnamesAmong,
  flattenForNameMatch,
  judgeLeadAgainstSite,
  peopleSubpageUrls,
  personSlugsOnSite,
  profileSlugFromUrl,
  rollUpVerificationState,
  siteHaystack,
  siteNamesPerson,
  surnameCore,
  surnameInSiteUrl,
  unreachableLabSiteVerification,
  type LabSiteLeadCandidate,
  type LabSiteLeadJudgement,
} from '../labSiteLeadVerificationCore';

const lead = (overrides: Partial<LabSiteLeadCandidate> = {}): LabSiteLeadCandidate => ({
  personId: '000000000000000000000001',
  role: 'PI',
  displayName: 'Robin Quill',
  officialProfileUrls: ['https://medicine.yale.edu/profile/robin-quill/'],
  ...overrides,
});

const judge = (
  candidate: LabSiteLeadCandidate,
  html: string,
  website = 'https://medicine.yale.edu/lab/quill/',
) =>
  judgeLeadAgainstSite(
    candidate,
    { website, visitedUrls: [website], html },
    personSlugsOnSite(html),
    siteHaystack(html, [website]),
  );

describe('flattenForNameMatch', () => {
  it('reduces every separator shape to one space so a name reads the same everywhere', () => {
    expect(flattenForNameMatch('Robin_Quill')).toBe('robin quill');
    expect(flattenForNameMatch('robin-quill.bsky.social')).toBe('robin quill bsky social');
    expect(flattenForNameMatch('Ünlü  Quill')).toBe('unlu quill');
  });
});

describe('surnameCore', () => {
  it('drops credentials and leading particles', () => {
    expect(surnameCore('Robin Quill, MD, PhD')).toBe('quill');
    expect(surnameCore('Robin van der Quill')).toBe('quill');
  });

  it('is empty for a nameless value', () => {
    expect(surnameCore('')).toBe('');
    expect(surnameCore(undefined)).toBe('');
  });
});

describe('siteNamesPerson', () => {
  const hay = (html: string) => siteHaystack(html);

  it('accepts the full name in prose', () => {
    expect(siteNamesPerson(hay('<p>Welcome to the lab of Robin Quill.</p>'), 'Robin Quill')).toBe(
      true,
    );
  });

  it('accepts a middle initial between given and family name', () => {
    expect(siteNamesPerson(hay('<p>Robin A. Quill, PhD</p>'), 'Robin Quill')).toBe(true);
  });

  it('accepts a surname-first listing', () => {
    expect(siteNamesPerson(hay('<td>Quill, Robin</td>'), 'Robin Quill')).toBe(true);
  });

  // Every one of these shapes was a FALSE CONTRADICTION under a visible-text-only
  // matcher with word boundaries: 42 of 62 re-checked rows were false positives.
  it('accepts a name carried only in an href slug', () => {
    expect(siteNamesPerson(hay('<a href="/people/robin_quill">Lab head</a>'), 'Robin Quill')).toBe(
      true,
    );
  });

  it('accepts a concatenated name in a host or handle', () => {
    expect(
      siteNamesPerson(hay('<a href="https://robinquill.bsky.social">us</a>'), 'Robin Quill'),
    ).toBe(true);
  });

  it('rejects a same-surname stranger', () => {
    expect(siteNamesPerson(hay('<p>Dale Quill runs this lab.</p>'), 'Robin Quill')).toBe(false);
  });

  it('rejects a same-given-name stranger', () => {
    expect(siteNamesPerson(hay('<p>Robin Sparrow runs this lab.</p>'), 'Robin Quill')).toBe(false);
  });

  it('rejects given and family name separated by a long run of other words', () => {
    expect(siteNamesPerson(hay('<p>Robin one two three four five Quill</p>'), 'Robin Quill')).toBe(
      false,
    );
  });

  it('refuses to judge a single-token display name', () => {
    expect(siteNamesPerson(hay('<p>Quill</p>'), 'Quill')).toBe(false);
  });
});

describe('surnameInSiteUrl', () => {
  it('accepts a dedicated domain published under the surname', () => {
    expect(surnameInSiteUrl('https://quill-lab.yale.edu/', 'Robin Quill')).toBe(true);
    expect(surnameInSiteUrl('https://quilllab.org/', 'Robin Quill')).toBe(true);
  });

  // A path segment on a multi-lab CMS names the lab, not which same-surname
  // person leads it, so treating it as confirmation would certify the very
  // namesake collision this lane exists to catch.
  it('refuses a surname that appears only in a shared-CMS path segment', () => {
    expect(surnameInSiteUrl('https://medicine.yale.edu/lab/quill/', 'Robin Quill')).toBe(false);
  });

  it('refuses a non-URL', () => {
    expect(surnameInSiteUrl('lab/quill', 'Robin Quill')).toBe(false);
  });

  it('refuses a surname short enough to collide by chance', () => {
    expect(surnameInSiteUrl('https://medicine.yale.edu/lab/pi/', 'Hana Pi')).toBe(false);
  });

  it('refuses a display name with no given name to pair the surname with', () => {
    expect(surnameInSiteUrl('https://quill-lab.yale.edu/', 'Quill')).toBe(false);
  });
});

describe('personSlugsOnSite', () => {
  it('collects person slugs across the person-page path shapes', () => {
    const slugs = personSlugsOnSite(
      '<a href="/lab/quill/profile/dale-quill/">Dale</a><a href="/people/ada-brook">Ada</a>',
    );
    expect([...slugs].sort()).toEqual(['ada-brook', 'dale-quill']);
  });

  it('drops section and listing slugs that name no person', () => {
    const slugs = personSlugsOnSite(
      '<a href="/people/faculty">Faculty</a><a href="/profile/join-our-team">Join</a>',
    );
    expect(slugs.size).toBe(0);
  });
});

describe('profileSlugFromUrl', () => {
  it('reads the trailing segment and tolerates a missing slash', () => {
    expect(profileSlugFromUrl('https://medicine.yale.edu/profile/robin-quill/')).toBe(
      'robin-quill',
    );
    expect(profileSlugFromUrl('https://medicine.yale.edu/profile/robin-quill')).toBe('robin-quill');
  });

  it('is empty for a non-URL', () => {
    expect(profileSlugFromUrl('not a url')).toBe('');
    expect(profileSlugFromUrl(undefined)).toBe('');
  });
});

describe('peopleSubpageUrls', () => {
  const base = 'https://medicine.yale.edu/lab/quill/';

  it('follows people pages inside the same subtree', () => {
    const html =
      '<a href="/lab/quill/members">Members</a><a href="/lab/quill/contact/">Contact</a>' +
      '<a href="/lab/quill/pubs">Publications</a>';
    expect(peopleSubpageUrls(html, base)).toEqual([
      'https://medicine.yale.edu/lab/quill/members',
      'https://medicine.yale.edu/lab/quill/contact/',
    ]);
  });

  it('never leaves the subtree, so a shared CMS cannot lend another lab its people', () => {
    const html = '<a href="/lab/sparrow/members">Other lab</a><a href="/people/directory">All</a>';
    expect(peopleSubpageUrls(html, base)).toEqual([]);
  });

  it('never leaves the host', () => {
    expect(
      peopleSubpageUrls('<a href="https://elsewhere.org/lab/quill/members">M</a>', base),
    ).toEqual([]);
  });

  it('resolves the subtree of a page-file landing URL', () => {
    const html = '<a href="/lab/quill/members">Members</a>';
    expect(peopleSubpageUrls(html, 'https://medicine.yale.edu/lab/quill/index.aspx')).toEqual([
      'https://medicine.yale.edu/lab/quill/members',
    ]);
  });

  it('honours the page limit', () => {
    const html = ['members', 'people', 'team', 'contact', 'about', 'staff', 'faculty']
      .map((word) => `<a href="/lab/quill/${word}">x</a>`)
      .join('');
    expect(peopleSubpageUrls(html, base, 2)).toHaveLength(2);
  });
});

describe('judgeLeadAgainstSite', () => {
  it('confirms on the lead own official profile link', () => {
    const result = judge(lead(), '<a href="/lab/quill/profile/robin-quill/">Robin</a>');
    expect(result).toMatchObject({
      verdict: 'CONFIRMED',
      matchedBy: 'OFFICIAL_PROFILE_LINK',
      evidenceUrl: 'https://medicine.yale.edu/profile/robin-quill/',
    });
  });

  it('confirms on being named, when no profile is linked', () => {
    const result = judge(lead(), '<p>The lab of Robin Quill studies things.</p>');
    expect(result.verdict).toBe('CONFIRMED');
    expect(result.matchedBy).toBe('NAMED_ON_PAGE');
  });

  it('confirms on the site hostname carrying the surname, as the weakest signal', () => {
    const result = judge(lead(), '<p>Welcome.</p>', 'https://quill-lab.yale.edu/');
    expect(result.verdict).toBe('CONFIRMED');
    expect(result.matchedBy).toBe('SURNAME_IN_SITE_URL');
  });

  it('refuses the surname signal when the entity leads disagree over that surname', () => {
    const result = judgeLeadAgainstSite(
      lead(),
      {
        website: 'https://quill-lab.yale.edu/',
        visitedUrls: ['https://quill-lab.yale.edu/'],
        html: '<p>Welcome.</p>',
      },
      new Set(),
      siteHaystack('<p>Welcome.</p>'),
      new Set(['quill']),
    );
    expect(result.verdict).toBe('UNSTATED');
  });

  // The namesake collision this lane exists to catch: the lab page cites a
  // different same-surname person as its own lead.
  it('contradicts when the site names a different same-surname person instead', () => {
    const result = judge(
      lead({ displayName: 'Robin Quill' }),
      '<p>Welcome to the lab of Dale Quill.</p><a href="/lab/quill/profile/dale-quill/">Dale</a>',
    );
    expect(result).toMatchObject({
      verdict: 'CONTRADICTED',
      matchedBy: 'NONE',
      evidenceUrl: 'https://medicine.yale.edu/lab/quill/',
    });
  });

  // Omission is not absence: a page that states nothing must never accuse.
  it('reports UNSTATED, never CONTRADICTED, when the site names nobody at all', () => {
    const result = judge(lead(), '<p>Our research spans many topics.</p>', 'https://cmb-lab.org/');
    expect(result.verdict).toBe('UNSTATED');
    expect(result.evidenceUrl).toBe('');
  });

  it('reports UNSTATED when the only person-shaped links are section listings', () => {
    const result = judge(
      lead(),
      '<a href="/people/faculty">Faculty</a><a href="/profile/join-our-team">Join</a>',
      'https://cmb-lab.org/',
    );
    expect(result.verdict).toBe('UNSTATED');
  });

  it('does not treat the lead own linked profile as somebody else', () => {
    const result = judge(
      lead(),
      '<a href="/profile/robin-quill/">Robin</a><a href="/people/ada-brook">Ada</a>',
    );
    expect(result.verdict).toBe('CONFIRMED');
  });
});

describe('rollUpVerificationState', () => {
  const judgement = (verdict: LabSiteLeadJudgement['verdict']): LabSiteLeadJudgement => ({
    personId: '000000000000000000000001',
    role: 'PI',
    verdict,
    matchedBy: verdict === 'CONFIRMED' ? 'NAMED_ON_PAGE' : 'NONE',
    evidenceUrl: '',
  });

  it('lets one contradiction dominate a page of confirmations', () => {
    expect(rollUpVerificationState([judgement('CONFIRMED'), judgement('CONTRADICTED')])).toBe(
      'contradicted',
    );
  });

  it('reports verified only when every lead is confirmed', () => {
    expect(rollUpVerificationState([judgement('CONFIRMED'), judgement('CONFIRMED')])).toBe(
      'verified',
    );
    expect(rollUpVerificationState([judgement('CONFIRMED'), judgement('UNSTATED')])).toBe(
      'partial',
    );
    expect(rollUpVerificationState([judgement('UNSTATED')])).toBe('unstated');
    expect(rollUpVerificationState([])).toBe('unstated');
  });
});

describe('contestedSurnamesAmong', () => {
  it('reports a surname two leads share with different given names', () => {
    expect([
      ...contestedSurnamesAmong([
        lead({ displayName: 'Robin Quill' }),
        lead({ displayName: 'Dale Quill' }),
      ]),
    ]).toEqual(['quill']);
  });

  it('does not report a surname carried by one person recorded twice', () => {
    expect(
      contestedSurnamesAmong([
        lead({ displayName: 'Robin Quill' }),
        lead({ displayName: 'Robin Quill, PhD' }),
      ]).size,
    ).toBe(0);
  });
});

describe('buildLabSiteLeadVerification', () => {
  const observedAt = new Date('2026-09-14T12:00:00.000Z');

  it('counts each verdict and stores a person reference but never a name', () => {
    const verification = buildLabSiteLeadVerification(
      [
        lead({ personId: '000000000000000000000001', displayName: 'Robin Quill' }),
        lead({
          personId: '000000000000000000000002',
          displayName: 'Dale Quill',
          officialProfileUrls: ['https://medicine.yale.edu/profile/dale-quill/'],
        }),
      ],
      {
        website: 'https://medicine.yale.edu/lab/quill/',
        visitedUrls: ['https://medicine.yale.edu/lab/quill/'],
        html: '<a href="/lab/quill/profile/robin-quill/">Robin Quill</a>',
        httpStatusCode: 200,
      },
      observedAt,
    );
    // The unlinked same-surname co-lead is CONTRADICTED, not merely unstated:
    // the page positively names the other person via a profile link.
    expect(verification.state).toBe('contradicted');
    expect(verification.confirmedCount).toBe(1);
    expect(verification.contradictedCount).toBe(1);
    expect(verification.unstatedCount).toBe(0);
    expect(verification.observedAt).toBe('2026-09-14T12:00:00.000Z');
    expect(JSON.stringify(verification)).not.toContain('Quill');
  });

  it('bounds the number of judged leads', () => {
    const many = Array.from({ length: 25 }, (_value, index) =>
      lead({ personId: String(index).padStart(24, '0') }),
    );
    const verification = buildLabSiteLeadVerification(
      many,
      { website: 'https://quill-lab.yale.edu/', visitedUrls: [], html: '<p>hi</p>' },
      observedAt,
    );
    expect(verification.leads).toHaveLength(20);
  });

  it('omits httpStatusCode rather than storing a placeholder', () => {
    const verification = buildLabSiteLeadVerification(
      [lead()],
      { website: 'https://quill-lab.yale.edu/', visitedUrls: [], html: '<p>hi</p>' },
      observedAt,
    );
    expect(verification).not.toHaveProperty('httpStatusCode');
  });
});

describe('unreachableLabSiteVerification', () => {
  it('records the dead site without judging any lead', () => {
    const verification = unreachableLabSiteVerification(
      'https://medicine.yale.edu/lab/gone/',
      new Date('2026-09-14T12:00:00.000Z'),
      404,
    );
    expect(verification).toMatchObject({
      state: 'unreachable',
      httpStatusCode: 404,
      pagesRead: 0,
      confirmedCount: 0,
      contradictedCount: 0,
      unstatedCount: 0,
      leads: [],
    });
  });
});
