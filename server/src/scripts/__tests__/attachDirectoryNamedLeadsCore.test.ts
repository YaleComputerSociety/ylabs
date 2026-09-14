import { describe, expect, it } from 'vitest';
import {
  directoryPersonPageCandidates,
  headingNameFromHtml,
  headingNamesPerson,
  isFacultyDirectoryPersonPage,
  pathDeclaresAPerson,
  planDirectoryLeadAttachment,
  urlNamesPerson,
  type VerifiedDirectoryPage,
} from '../attachDirectoryNamedLeadsCore';

const NURSING_PAGE = 'https://nursing.yale.edu/faculty-research/faculty-directory/rowan-tallis-mph';
const LAW_PAGE = 'https://law.yale.edu/rowan-tallis';

function pages(
  entries: Array<[string, VerifiedDirectoryPage]>,
): Map<string, VerifiedDirectoryPage> {
  return new Map(entries);
}

describe('isFacultyDirectoryPersonPage', () => {
  it('accepts a per-person page on each listed host', () => {
    expect(isFacultyDirectoryPersonPage(NURSING_PAGE)).toBe(true);
    expect(
      isFacultyDirectoryPersonPage(
        'https://som.yale.edu/faculty-research/faculty-directory/rowan-tallis',
      ),
    ).toBe(true);
    expect(
      isFacultyDirectoryPersonPage(
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/rowan-tallis',
      ),
    ).toBe(true);
    expect(isFacultyDirectoryPersonPage(LAW_PAGE)).toBe(true);
    expect(isFacultyDirectoryPersonPage('https://jackson.yale.edu/rowan-tallis')).toBe(true);
  });

  it('refuses the directory landing page itself', () => {
    expect(
      isFacultyDirectoryPersonPage('https://nursing.yale.edu/faculty-research/faculty-directory/'),
    ).toBe(false);
    expect(
      isFacultyDirectoryPersonPage('https://som.yale.edu/faculty-research/faculty-directory'),
    ).toBe(false);
  });

  it('refuses a deeper path than a single person segment', () => {
    expect(
      isFacultyDirectoryPersonPage(
        'https://nursing.yale.edu/faculty-research/faculty-directory/rowan-tallis-mph/publications',
      ),
    ).toBe(false);
  });

  it('refuses http, an unlisted host and a non-url', () => {
    expect(isFacultyDirectoryPersonPage('http://law.yale.edu/rowan-tallis')).toBe(false);
    expect(isFacultyDirectoryPersonPage('https://law.harvard.edu/rowan-tallis')).toBe(false);
    expect(isFacultyDirectoryPersonPage('not a url')).toBe(false);
    expect(isFacultyDirectoryPersonPage(undefined)).toBe(false);
  });
});

describe('headingNamesPerson', () => {
  it('accepts a heading that adds credentials and a middle initial', () => {
    expect(headingNamesPerson('Rowan Q. Tallis, PhD, APRN, PPCNP-BC, FAAN', 'Rowan Tallis')).toBe(
      true,
    );
  });

  it('folds accents and punctuation on both sides', () => {
    expect(headingNamesPerson('Rowán Ü. Tállis', 'Rowan Tallis')).toBe(true);
  });

  it('refuses a heading that shares only the surname', () => {
    expect(headingNamesPerson('Marlow Tallis', 'Rowan Tallis')).toBe(false);
  });

  it('refuses a single-token person name, because that is surname matching', () => {
    expect(headingNamesPerson('Rowan Tallis', 'Tallis')).toBe(false);
  });

  it('refuses an empty heading', () => {
    expect(headingNamesPerson('', 'Rowan Tallis')).toBe(false);
    expect(headingNamesPerson(undefined, 'Rowan Tallis')).toBe(false);
  });
});

describe('urlNamesPerson', () => {
  it('accepts a url carrying every token of the person name', () => {
    expect(urlNamesPerson(NURSING_PAGE, 'Rowan Tallis')).toBe(true);
  });

  it('refuses a url carrying only the surname', () => {
    expect(urlNamesPerson('https://law.yale.edu/tallis', 'Rowan Tallis')).toBe(false);
  });

  it('refuses a person name of fewer than two usable tokens', () => {
    expect(urlNamesPerson(NURSING_PAGE, 'Tallis')).toBe(false);
    expect(urlNamesPerson(NURSING_PAGE, '')).toBe(false);
  });
});

describe('headingNameFromHtml', () => {
  it('reads the first h1 and strips nested markup and entities', () => {
    const html =
      '<main><h1 class="x">Rowan <span>Q.</span> Tallis&nbsp;&amp; Co</h1><h1>Other</h1></main>';
    expect(headingNameFromHtml(html)).toBe('Rowan Q. Tallis & Co');
  });

  it('returns empty when there is no h1', () => {
    expect(headingNameFromHtml('<p>Rowan Tallis</p>')).toBe('');
  });
});

describe('pathDeclaresAPerson', () => {
  it('is true for a path that names a person segment', () => {
    expect(pathDeclaresAPerson(NURSING_PAGE)).toBe(true);
    expect(pathDeclaresAPerson('https://medicine.yale.edu/profile/rowan-tallis/')).toBe(true);
  });

  it('is false for the two hosts whose person pages are a bare segment', () => {
    expect(pathDeclaresAPerson(LAW_PAGE)).toBe(false);
    expect(pathDeclaresAPerson('https://jackson.yale.edu/rowan-tallis')).toBe(false);
  });

  it('is false for a non-url', () => {
    expect(pathDeclaresAPerson('not a url')).toBe(false);
  });
});

describe('directoryPersonPageCandidates', () => {
  it('deduplicates and keeps directory person pages and shared-predicate profiles', () => {
    expect(
      directoryPersonPageCandidates({
        sourceUrls: [
          NURSING_PAGE,
          NURSING_PAGE,
          'https://medicine.yale.edu/profile/rowan-tallis/',
          'https://example.org/x',
          42,
        ],
      }),
    ).toEqual([NURSING_PAGE, 'https://medicine.yale.edu/profile/rowan-tallis/']);
  });
});

describe('planDirectoryLeadAttachment', () => {
  const entity = {
    slug: 'rowan-tallis-faculty-research',
    name: 'Rowan Tallis Faculty Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    sourceUrls: [NURSING_PAGE],
    studentVisibilityReasons: ['missing_lead', 'missing_action_evidence'],
  };
  const verified = pages([
    [NURSING_PAGE, { status: 200, headingName: 'Rowan Q. Tallis, PhD, APRN' }],
  ]);

  it('plans an attachment when the page names the person the row names', () => {
    expect(planDirectoryLeadAttachment(entity, verified, new Set())).toEqual({
      personName: 'Rowan Tallis',
      profileUrl: NURSING_PAGE,
    });
  });

  it('refuses a row whose name yields no person', () => {
    expect(
      planDirectoryLeadAttachment({ ...entity, name: 'Tallis Lab' }, verified, new Set()),
    ).toBeNull();
  });

  it('refuses a row held by another hard blocker, so an attachment is never counted as a promotion', () => {
    expect(
      planDirectoryLeadAttachment(
        { ...entity, studentVisibilityReasons: ['missing_lead', 'missing_card_description'] },
        verified,
        new Set(),
      ),
    ).toBeNull();
  });

  it('refuses a row that is not lead blocked at all', () => {
    expect(
      planDirectoryLeadAttachment(
        { ...entity, studentVisibilityReasons: ['missing_action_evidence'] },
        verified,
        new Set(),
      ),
    ).toBeNull();
  });

  it('refuses when the row cites two directory person pages, because neither is decisive', () => {
    const twoPages = pages([
      [NURSING_PAGE, { status: 200, headingName: 'Rowan Tallis' }],
      [LAW_PAGE, { status: 200, headingName: 'Rowan Tallis' }],
    ]);
    expect(
      planDirectoryLeadAttachment(
        { ...entity, sourceUrls: [NURSING_PAGE, LAW_PAGE] },
        twoPages,
        new Set(),
      ),
    ).toBeNull();
  });

  it('refuses a bare-segment host whose url does not carry every token of the person name', () => {
    const otherPage = 'https://law.yale.edu/marlow-tallis';
    expect(
      planDirectoryLeadAttachment(
        { ...entity, sourceUrls: [otherPage] },
        pages([[otherPage, { status: 200, headingName: 'Rowan Tallis' }]]),
        new Set(),
      ),
    ).toBeNull();
  });

  it('plans on a person-declaring path whose slug spells another name form, when the heading names the person', () => {
    const nicknameSlug = 'https://medicine.yale.edu/profile/rowie-t-ashdown-tallis/';
    expect(
      planDirectoryLeadAttachment(
        { ...entity, sourceUrls: [nicknameSlug] },
        pages([[nicknameSlug, { status: 200, headingName: 'Rowan Tallis, MD' }]]),
        new Set(),
      ),
    ).toEqual({ personName: 'Rowan Tallis', profileUrl: nicknameSlug });
  });

  it('still refuses a person-declaring path whose heading names a different person', () => {
    const otherProfile = 'https://medicine.yale.edu/profile/rowan-tallis/';
    expect(
      planDirectoryLeadAttachment(
        { ...entity, sourceUrls: [otherProfile] },
        pages([[otherProfile, { status: 200, headingName: 'Marlow Ashdown' }]]),
        new Set(),
      ),
    ).toBeNull();
  });

  it('refuses when the page was never verified', () => {
    expect(planDirectoryLeadAttachment(entity, pages([]), new Set())).toBeNull();
  });

  it('refuses when the page did not return 200, so a dead page never mints a lead', () => {
    expect(
      planDirectoryLeadAttachment(
        entity,
        pages([[NURSING_PAGE, { status: 404, headingName: 'Rowan Tallis' }]]),
        new Set(),
      ),
    ).toBeNull();
  });

  it('refuses when the page heading names a different person', () => {
    expect(
      planDirectoryLeadAttachment(
        entity,
        pages([[NURSING_PAGE, { status: 200, headingName: 'Marlow Ashdown' }]]),
        new Set(),
      ),
    ).toBeNull();
  });

  it('refuses when the profile url is already claimed by an existing researcher', () => {
    expect(
      planDirectoryLeadAttachment(
        entity,
        verified,
        new Set(['nursing.yale.edu/faculty-research/faculty-directory/rowan-tallis-mph']),
      ),
    ).toBeNull();
  });
});
