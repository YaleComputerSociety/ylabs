import { describe, expect, it } from 'vitest';
import {
  isBoilerplateHostWebsiteUrl,
  isContentPageUrl,
  isFileShareOrDocumentWebsiteUrl,
  isGrantOrIdentifierUrl,
  isListingPageWebsiteUrl,
  isMultiTenantHostRootWebsiteUrl,
  isPressOrNewsHostWebsiteUrl,
  isProfilePageWebsiteUrl,
  isPromotableWebsiteUrl,
  isPublicHttpUrl,
  isRosterPageWebsiteUrlForPerson,
  resolveBackfillWebsiteUrl,
  selectBackfillWebsiteUrl,
} from '../backfillResearchEntityWebsiteUrlsCore';
import { isRosterPageCitedByPerson } from '../retireGraftedDirectoryUrlsCore';
import {
  assertResearchEntityWebsiteUrlApplyAllowed,
  parseResearchEntityWebsiteUrlBackfillArgs,
  LISTING_PAGE_WEBSITE_URL_PATTERN,
  PROFILE_PAGE_WEBSITE_URL_PATTERN,
} from '../backfillResearchEntityWebsiteUrls';
import {
  MULTI_TENANT_ACADEMIC_HOST_ROOT_URL_PATTERN,
  PRESS_AND_NEWS_HOST_URL_PATTERN,
} from '../../utils/researchHomeWebsiteUrl';

describe('backfillResearchEntityWebsiteUrls URL classification', () => {
  it('accepts public http and https URLs only', () => {
    expect(isPublicHttpUrl('https://ubel.yale.edu/')).toBe(true);
    expect(isPublicHttpUrl('http://lab.example.org/team')).toBe(true);
    expect(isPublicHttpUrl('ftp://files.yale.edu/x')).toBe(false);
    expect(isPublicHttpUrl('mailto:pi@yale.edu')).toBe(false);
    expect(isPublicHttpUrl('https://user:example@yale.edu/lab')).toBe(false);
    expect(isPublicHttpUrl('')).toBe(false);
    expect(isPublicHttpUrl(undefined)).toBe(false);
  });

  it('flags grant and identifier hosts', () => {
    expect(isGrantOrIdentifierUrl('https://reporter.nih.gov/project-details/123')).toBe(true);
    expect(isGrantOrIdentifierUrl('https://api.reporter.nih.gov/v2/x')).toBe(true);
    expect(isGrantOrIdentifierUrl('https://www.nsf.gov/awardsearch/x')).toBe(true);
    expect(isGrantOrIdentifierUrl('https://orcid.org/0000-0000-0000-0000')).toBe(true);
    expect(isGrantOrIdentifierUrl('https://scholar.google.com/citations?user=x')).toBe(true);
    expect(isGrantOrIdentifierUrl('https://doi.org/10.1000/xyz')).toBe(true);
    expect(isGrantOrIdentifierUrl('https://medicine.yale.edu/lab/smith/')).toBe(false);
    expect(isGrantOrIdentifierUrl('https://nih.gov.evil.example/lab')).toBe(false);
  });

  it('flags article and news content pages', () => {
    expect(isContentPageUrl('https://medicine.yale.edu/news/breakthrough/')).toBe(true);
    expect(isContentPageUrl('https://lab.yale.edu/blog/2026/update')).toBe(true);
    expect(isContentPageUrl('https://lab.yale.edu/events')).toBe(true);
    expect(isContentPageUrl('https://lab.yale.edu/research/')).toBe(false);
  });

  it('treats only official, non-grant, non-content URLs as promotable', () => {
    expect(isPromotableWebsiteUrl('https://ubel.yale.edu/')).toBe(true);
    expect(isPromotableWebsiteUrl('https://reporter.nih.gov/project-details/9')).toBe(false);
    expect(isPromotableWebsiteUrl('https://lab.yale.edu/news/x')).toBe(false);
  });

  it('never promotes profile, faculty-directory, or people-directory pages', () => {
    expect(
      isPromotableWebsiteUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
      ),
    ).toBe(false);
    expect(isPromotableWebsiteUrl('https://medicine.example.edu/profile/jordan-example/')).toBe(
      false,
    );
    expect(isPromotableWebsiteUrl('https://physics.example.edu/people/jordan-example/')).toBe(
      false,
    );
    expect(
      isProfilePageWebsiteUrl('https://labs.example.edu/directory/faculty/jordan-example/'),
    ).toBe(true);
    expect(isProfilePageWebsiteUrl('https://lab.example.org/')).toBe(false);
  });

  it('flags directory, index, and paginated listing pages', () => {
    expect(
      isListingPageWebsiteUrl('https://medicine.yale.edu/about/a-to-z-index/lab-websites'),
    ).toBe(true);
    expect(isListingPageWebsiteUrl('https://physics.yale.edu/people?page=8')).toBe(true);
    expect(isListingPageWebsiteUrl('https://physics.yale.edu/people')).toBe(true);
    expect(isListingPageWebsiteUrl('https://physics.yale.edu/people/faculty')).toBe(true);
    expect(isListingPageWebsiteUrl('https://medicine.yale.edu/mcdb/faculty/')).toBe(true);
    expect(isListingPageWebsiteUrl('https://example-computing-lab.example.org/')).toBe(false);
    expect(isListingPageWebsiteUrl('https://physics.yale.edu/people/jordan-example/')).toBe(false);
  });

  it('never promotes directory, index, or paginated listing pages', () => {
    expect(
      isPromotableWebsiteUrl('https://medicine.yale.edu/about/a-to-z-index/lab-websites'),
    ).toBe(false);
    expect(isPromotableWebsiteUrl('https://physics.yale.edu/people?page=8')).toBe(false);
    expect(isPromotableWebsiteUrl('https://physics.yale.edu/mcdb/faculty/')).toBe(false);
  });

  it('flags generic CMS/platform boilerplate hosts and never promotes them (#572)', () => {
    expect(isBoilerplateHostWebsiteUrl('http://wordpress.org/')).toBe(true);
    expect(isBoilerplateHostWebsiteUrl('https://www.squarespace.com/')).toBe(true);
    expect(isBoilerplateHostWebsiteUrl('https://rjohnwilliams.wordpress.com/')).toBe(false);
    expect(isPromotableWebsiteUrl('http://wordpress.org/')).toBe(false);
    expect(isPromotableWebsiteUrl('https://rjohnwilliams.wordpress.com/')).toBe(true);
  });

  it('flags file-share and direct-document links and never promotes them (#730)', () => {
    expect(isFileShareOrDocumentWebsiteUrl('https://drive.google.com/open/')).toBe(true);
    expect(isFileShareOrDocumentWebsiteUrl('https://www.dropbox.com/s/abc123/lab.pdf')).toBe(true);
    expect(
      isFileShareOrDocumentWebsiteUrl(
        'https://history.yale.edu/sites/default/files/files/2010%20rankin%20-%20epistemology%20of%20the%20suburbs.pdf',
      ),
    ).toBe(true);
    expect(isFileShareOrDocumentWebsiteUrl('https://example-computing-lab.example.org/')).toBe(
      false,
    );
    expect(isPromotableWebsiteUrl('https://drive.google.com/open/')).toBe(false);
    expect(isPromotableWebsiteUrl('https://lab.yale.edu/papers/summary.pdf')).toBe(false);
    expect(isPromotableWebsiteUrl('https://example-computing-lab.example.org/')).toBe(true);
  });
});

// A `websiteUrl` observation reaches the resolver without passing through
// `sourceUrlToResearchHomeWebsiteUrl`, which is why these hosts were refused as a
// promotion candidate yet still reachable as a stored value. Measured on
// Development: two sources emit the profile's Google Scholar link as a websiteUrl
// and 3 live entities stored one (#2285).
describe('resolveBackfillWebsiteUrl external scholarly platform handling', () => {
  it('clears a citation-index websiteUrl when no research home is available', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://scholar.google.com/citations?user=EXAMPLEPLACEHOLDER',
        sourceUrls: ['https://medicine.yale.edu/profile/jordan-example/'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('replaces a citation-index websiteUrl with a real research home from evidence', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://scholar.google.com/citations/',
        sourceUrls: [
          'https://medicine.yale.edu/profile/jordan-example/',
          'https://examplelab.yale.edu/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://examplelab.yale.edu/' });
  });

  it('clears an ORCID or ResearchGate websiteUrl on the same terms', () => {
    for (const websiteUrl of [
      'https://orcid.org/example-researcher-placeholder',
      'https://www.researchgate.net/profile/Jordan-Example',
      'https://api.nsf.gov/awards/1234',
    ]) {
      expect(
        resolveBackfillWebsiteUrl({
          websiteUrl,
          sourceUrls: ['https://medicine.yale.edu/profile/jordan-example/'],
        }),
        websiteUrl,
      ).toEqual({ action: 'clear' });
    }
  });

  it('keeps a real Yale lab site whose path merely mentions a platform', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://examplelab.yale.edu/scholar-google-metrics/',
        sourceUrls: ['https://medicine.yale.edu/profile/jordan-example/'],
      }),
    ).toEqual({ action: 'keep' });
  });
});

describe('resolveBackfillWebsiteUrl press and news host handling (#2532)', () => {
  it('clears a news-article websiteUrl when evidence has no research home', () => {
    for (const websiteUrl of [
      'https://news.yale.edu/2024/06/05/example-headline',
      'https://www.wsj.com/personal-finance/example-24057ac4',
      'https://www.cnn.com/2026/07/31/tv/video/example-segment',
    ]) {
      expect(
        resolveBackfillWebsiteUrl({
          websiteUrl,
          sourceUrls: ['https://medicine.yale.edu/profile/jordan-example/'],
        }),
        websiteUrl,
      ).toEqual({ action: 'clear' });
    }
  });

  it('replaces a news-article websiteUrl with a real research home from evidence', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://news.yale.edu/2024/06/05/example-headline',
        sourceUrls: [
          'https://news.yale.edu/2024/06/05/example-headline',
          'https://examplelab.yale.edu/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://examplelab.yale.edu/' });
  });

  it('keeps a research home whose own site merely reports news', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://examplelab.yale.edu/',
        sourceUrls: ['https://www.wsj.com/personal-finance/example-24057ac4'],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('is part of the unservable vocabulary rather than the promotable one alone', () => {
    expect(isPressOrNewsHostWebsiteUrl('https://news.yale.edu/2024/06/05/example')).toBe(true);
    expect(isPressOrNewsHostWebsiteUrl('https://examplelab.yale.edu/news/2024/update/')).toBe(false);
  });
});

describe('resolveBackfillWebsiteUrl listing handling', () => {
  it('clears an A-Z-index listing websiteUrl when no research home is available', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.yale.edu/about/a-to-z-index/lab-websites',
        sourceUrls: ['https://medicine.yale.edu/profile/jordan-example/'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('clears a bare people-directory listing websiteUrl when no research home is available', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://mcdb.yale.edu/people',
        sourceUrls: ['https://reporter.nih.gov/project-details/1'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('clears a paginated directory listing websiteUrl when no research home is available', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://mcdb.yale.edu/people?page=8',
        sourceUrls: [],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('clears a /team/directory faculty-roster-root websiteUrl when no research home exists (#569)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://isps.yale.edu/team/directory/faculty-fellows',
        sourceUrls: [],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('keeps a named per-person /directory/faculty profile websiteUrl (#556)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://environment.yale.edu/directory/faculty/jordan-example',
        sourceUrls: [],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('clears a boilerplate-host websiteUrl when no research home is available (#572)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'http://wordpress.org/',
        sourceUrls: ['http://wordpress.org/'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('re-picks a real research home over a boilerplate-host websiteUrl (#572)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'http://wordpress.org/',
        sourceUrls: ['https://example-computing-lab.example.org/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://example-computing-lab.example.org/' });
  });

  it('re-picks a real research home over a listing websiteUrl when one exists in evidence', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.yale.edu/about/a-to-z-index/lab-websites',
        sourceUrls: [
          'https://medicine.yale.edu/profile/jordan-example/',
          'https://example-computing-lab.example.org/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://example-computing-lab.example.org/' });
  });

  it('keeps a real lab-site websiteUrl untouched', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://example-computing-lab.example.org/',
        sourceUrls: ['https://centers.example.edu/genomics/'],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('keeps a profile-page websiteUrl when no research home exists (unchanged behavior)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.example.edu/profile/jordan-example/',
        sourceUrls: ['https://reporter.nih.gov/project-details/1'],
      }),
    ).toEqual({ action: 'keep' });
  });

  // A lab minted from its PI's faculty-directory page cites that page as its own
  // source, so keeping it as `websiteUrl` made the detail page render the same
  // destination twice: once as "Website" and once as the official-profile CTA.
  it('clears a faculty-directory websiteUrl the entity cites as its own source (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://engineering.example.edu/faculty-directory/jordan-example',
        sourceUrls: [
          'https://engineering.example.edu/faculty-directory/jordan-example',
          'https://institute.example.edu/humans/faculty',
        ],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('clears a Google Drive share-link websiteUrl when no research home is available (#730)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://drive.google.com/open/',
        sourceUrls: [
          'https://drive.google.com/open?id=1QwRyarvB_ZeBtk_IvIA77E_eSvYFwmOp&usp=drive_copy',
        ],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('clears a direct-document (.pdf) websiteUrl when no research home is available (#730)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl:
          'https://history.yale.edu/sites/default/files/files/2010%20rankin%20-%20epistemology%20of%20the%20suburbs.pdf',
        sourceUrls: [],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('re-picks a real research home over a file-share websiteUrl when one exists in evidence (#730)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://drive.google.com/open/',
        sourceUrls: [
          'https://drive.google.com/open?id=1QwRyarvB_ZeBtk_IvIA77E_eSvYFwmOp&usp=drive_copy',
          'https://example-computing-lab.example.org/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://example-computing-lab.example.org/' });
  });

  it('clears a people-roster (members) listing websiteUrl when no research home exists (#518)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://quantuminstitute.example.edu/people/members',
        sourceUrls: ['https://quantuminstitute.example.edu/people/members'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('corrects a people-index subpage to the lab home when one exists in evidence (#518)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.example.edu/lab/simons/people/index.aspx',
        sourceUrls: ['https://medicine.example.edu/lab/simons/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://medicine.example.edu/lab/simons/' });
  });

  it('clears a bare people-index (people.html) listing websiteUrl when no home exists (#518)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://qbio.example.edu/people.html',
        sourceUrls: ['https://qbio.example.edu/people.html'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('clears a single-person /people/ profile page the entity already cites (#518, #2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://economics.example.edu/people/jordan-example',
        sourceUrls: ['https://economics.example.edu/people/jordan-example'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('keeps a single-person profile page the entity cites nowhere else (#518)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://economics.example.edu/people/jordan-example',
        sourceUrls: ['https://reporter.nih.gov/project-details/1'],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('ignores a trailing slash and case when matching the cited profile page (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://Economics.example.edu/people/Jordan-Example/',
        sourceUrls: ['https://economics.example.edu/people/jordan-example'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('ignores scheme and a www. prefix when matching the cited profile page (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'http://www.economics.example.edu/people/jordan-example/',
        sourceUrls: ['https://economics.example.edu/people/jordan-example'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('keeps a profile page cited only by the legacy website field, which the page never renders (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://economics.example.edu/people/jordan-example',
        website: 'https://economics.example.edu/people/jordan-example',
        sourceUrls: [],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('keeps a cited department-roster profile page the detail page refuses to re-render (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://economics.yale.edu/people/faculty/jordan-example',
        sourceUrls: ['https://economics.yale.edu/people/faculty/jordan-example'],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('keeps a cited collective-leaf roster page the detail page refuses to re-render (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://whc.yale.edu/people/our-people',
        sourceUrls: ['https://whc.yale.edu/people/our-people'],
      }),
    ).toEqual({ action: 'keep' });
  });
});

describe('multi-tenant academic host roots (#2359)', () => {
  it('refuses to promote the root of a host whose members publish at ~user', () => {
    expect(isMultiTenantHostRootWebsiteUrl('https://csl.yale.edu/')).toBe(true);
    expect(isPromotableWebsiteUrl('https://csl.yale.edu/')).toBe(false);
  });

  it('still promotes a tenant page under the same host', () => {
    expect(isMultiTenantHostRootWebsiteUrl('https://csl.yale.edu/~arun/')).toBe(false);
    expect(isPromotableWebsiteUrl('https://csl.yale.edu/~arun/')).toBe(true);
  });

  it('clears a shared host root when the entity has no other research home', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11046553',
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/rajit-example/',
          'https://csl.yale.edu/',
        ],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('re-picks the tenant page when the entity has one in its evidence', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: ['https://csl.yale.edu/', 'https://csl.yale.edu/~arun/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://csl.yale.edu/~arun/' });
  });

  it('re-picks the tenant page on a multi-label host too, instead of clearing', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://gauss.math.yale.edu/',
        sourceUrls: ['https://gauss.math.yale.edu/', 'https://gauss.math.yale.edu/~an592/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://gauss.math.yale.edu/~an592/' });
  });

  it('rejects the `www.` alias of a shared host root as well', () => {
    expect(isMultiTenantHostRootWebsiteUrl('https://www.csl.yale.edu/')).toBe(true);
    expect(isPromotableWebsiteUrl('https://www.csl.yale.edu/')).toBe(false);
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://www.csl.yale.edu/',
        sourceUrls: ['https://www.csl.yale.edu/', 'https://www.csl.yale.edu/~arun/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://www.csl.yale.edu/~arun/' });
  });

  it('keeps the shared host root for the host organization’s own entity', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Computer Systems Lab',
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
    ).toEqual({ action: 'keep' });
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Manohar Lab',
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('promotes the shared host root for the host organization when it has no website', () => {
    expect(
      resolveBackfillWebsiteUrl({
        displayName: 'Computer Systems Lab',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://csl.yale.edu/' });
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Manohar Lab',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
    ).toEqual({ action: 'keep' });
  });
});

describe('selectBackfillWebsiteUrl', () => {
  it('leaves an entity that already has a usable websiteUrl untouched', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: 'https://lab.yale.edu/',
        website: 'https://other.yale.edu/',
        sourceUrls: ['https://third.yale.edu/'],
      }),
    ).toBeUndefined();
  });

  it('promotes the website field when websiteUrl is empty', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: '',
        website: 'https://labhome.yale.edu/',
        sourceUrls: ['https://reporter.nih.gov/project-details/1'],
      }),
    ).toBe('https://labhome.yale.edu/');
  });

  it('promotes the first promotable sourceUrl when website is absent', () => {
    expect(
      selectBackfillWebsiteUrl({
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://orcid.org/0000-0000-0000-0000',
          'https://centers.yale.edu/genomics/',
          'https://another.yale.edu/',
        ],
      }),
    ).toBe('https://centers.yale.edu/genomics/');
  });

  it('skips file-share and direct-document candidates when choosing a sourceUrl (#730)', () => {
    expect(
      selectBackfillWebsiteUrl({
        sourceUrls: [
          'https://drive.google.com/open/',
          'https://lab.yale.edu/papers/summary.pdf',
          'https://lab.yale.edu/',
        ],
      }),
    ).toBe('https://lab.yale.edu/');
  });

  it('skips content pages when choosing a sourceUrl', () => {
    expect(
      selectBackfillWebsiteUrl({
        sourceUrls: ['https://lab.yale.edu/news/story', 'https://lab.yale.edu/'],
      }),
    ).toBe('https://lab.yale.edu/');
  });

  it('returns undefined when every candidate is a grant, identifier, or content URL', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: '',
        website: '',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://www.nsf.gov/awardsearch/2',
          'https://lab.yale.edu/blog/post',
        ],
      }),
    ).toBeUndefined();
  });

  it('replaces a non-http websiteUrl placeholder with a promotable evidence URL', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: 'reporter.nih.gov/project/1',
        sourceUrls: ['https://lab.yale.edu/'],
      }),
    ).toBe('https://lab.yale.edu/');
  });

  it('prefers a real lab site over a faculty-directory page earlier in sourceUrls', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: '',
        sourceUrls: [
          'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1',
          'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
          'https://example-computing-lab.example.org/',
        ],
      }),
    ).toBe('https://example-computing-lab.example.org/');
  });

  it('corrects an existing faculty-directory websiteUrl to a better source URL', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl:
          'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
          'https://example-computing-lab.example.org/',
        ],
      }),
    ).toBe('https://example-computing-lab.example.org/');
  });

  it('corrects an existing profile-page websiteUrl to a better source URL', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.example.edu/profile/jordan-example/',
        sourceUrls: ['https://campuspress-example.example.edu/jordan-example/'],
      }),
    ).toBe('https://campuspress-example.example.edu/jordan-example/');
  });

  it('leaves a profile-page websiteUrl untouched when no better source URL exists', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.example.edu/profile/jordan-example/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://physics.example.edu/people/jordan-example/',
        ],
      }),
    ).toBeUndefined();
  });

  it('leaves a real lab-site websiteUrl untouched even when other candidates exist', () => {
    expect(
      selectBackfillWebsiteUrl({
        websiteUrl: 'https://example-computing-lab.example.org/',
        sourceUrls: ['https://centers.example.edu/genomics/'],
      }),
    ).toBeUndefined();
  });
});

describe('prefers a real lab site over a directory/profile stub (#537)', () => {
  it('re-picks a Google Sites lab site over a faculty-directory stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl:
          'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
        sourceUrls: [
          'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1',
          'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
          'https://sites.google.com/view/example-lab',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://sites.google.com/view/example-lab/' });
  });

  it('re-picks a Google Sites lab site over a /profile/ stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://math.example.edu/profile/jordan-example/',
        sourceUrls: [
          'https://math.example.edu/profile/jordan-example/',
          'https://sites.google.com/view/jordan-example',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://sites.google.com/view/jordan-example/' });
  });

  it('re-picks a domain-scoped Google Sites lab site over a /people/ stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://economics.example.edu/people/jordan-example',
        sourceUrls: [
          'https://economics.example.edu/people/jordan-example',
          'https://sites.google.com/yale.edu/jordan-example/home',
        ],
      }),
    ).toEqual({
      action: 'set',
      websiteUrl: 'https://sites.google.com/yale.edu/jordan-example/home/',
    });
  });

  it('re-picks a custom Yale lab subdomain over a /people/ stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://quantuminstitute.example.edu/people/jordan-example',
        sourceUrls: [
          'https://quantuminstitute.example.edu/people/jordan-example',
          'https://example-lab.yale.edu/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://example-lab.yale.edu/' });
  });

  it('re-picks a github.io lab site over a /people/ stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://quantuminstitute.example.edu/people/jordan-example',
        sourceUrls: [
          'https://quantuminstitute.example.edu/people/jordan-example',
          'https://jordan-example.github.io/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://jordan-example.github.io/' });
  });

  it('re-picks a campuspress lab site over a faculty-directory stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://engineering.example.edu/directory/faculty/jordan-example/',
        sourceUrls: ['https://campuspress.yale.edu/example-lab/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://campuspress.yale.edu/example-lab/' });
  });

  it('re-picks an external personal lab domain over a /profile/ stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://som.example.edu/profile/jordan-example/',
        sourceUrls: ['https://example-computing-lab.example.org/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://example-computing-lab.example.org/' });
  });

  it('re-picks a specific lab path over a /faculty/ stub', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://medicine.example.edu/faculty/jordan-example/',
        sourceUrls: ['https://medicine.example.edu/lab/example/'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://medicine.example.edu/lab/example/' });
  });

  it('clears a lone directory/profile stub the entity already cites (#2352)', () => {
    expect(
      resolveBackfillWebsiteUrl({
        websiteUrl: 'https://math.example.edu/profile/jordan-example/',
        sourceUrls: [
          'https://math.example.edu/profile/jordan-example/',
          'https://reporter.nih.gov/project-details/1',
          'https://sites.google.com/',
        ],
      }),
    ).toEqual({ action: 'clear' });
  });
});

describe('parseResearchEntityWebsiteUrlBackfillArgs', () => {
  it('defaults to dry-run with no explicit limit', () => {
    const options = parseResearchEntityWebsiteUrlBackfillArgs([]);
    expect(options.dryRun).toBe(true);
    expect(options.confirm).toBe(false);
    expect(options.explicitLimit).toBe(false);
  });

  it('parses apply, confirm, and limit flags', () => {
    const options = parseResearchEntityWebsiteUrlBackfillArgs([
      '--apply',
      '--confirm-research-entity-website-urls',
      '--limit=50',
    ]);
    expect(options.dryRun).toBe(false);
    expect(options.confirm).toBe(true);
    expect(options.limit).toBe(50);
    expect(options.explicitLimit).toBe(true);
  });

  it('rejects a non-positive limit', () => {
    expect(() => parseResearchEntityWebsiteUrlBackfillArgs(['--limit=0'])).toThrow(
      /positive integer/,
    );
  });

  it('rejects unknown arguments', () => {
    expect(() => parseResearchEntityWebsiteUrlBackfillArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('collects repeated --slug scopes so a repair can be bounded to named rows', () => {
    const options = parseResearchEntityWebsiteUrlBackfillArgs([
      '--slug=dept-example-one',
      '--slug=dept-example-two',
    ]);
    expect(options.slugs).toEqual(['dept-example-one', 'dept-example-two']);
    expect(parseResearchEntityWebsiteUrlBackfillArgs([]).slugs).toEqual([]);
  });
});

describe('press and news host candidate reachability (#2532)', () => {
  // Without its own candidate pattern the press refusal is unreachable on stored
  // data: the backfill selects rows by URL shape, and an article matches none of
  // the other shapes, so the guard would never be consulted on the rows it exists
  // for.
  it('selects a stored news-article websiteUrl that no other candidate pattern matches', () => {
    for (const websiteUrl of [
      'https://news.yale.edu/2024/06/05/example-headline',
      'https://www.wsj.com/personal-finance/example-24057ac4',
      'https://www.cnn.com/2026/07/31/tv/video/example-segment',
    ]) {
      expect(PROFILE_PAGE_WEBSITE_URL_PATTERN.test(websiteUrl), websiteUrl).toBe(false);
      expect(LISTING_PAGE_WEBSITE_URL_PATTERN.test(websiteUrl), websiteUrl).toBe(false);
      expect(MULTI_TENANT_ACADEMIC_HOST_ROOT_URL_PATTERN.test(websiteUrl), websiteUrl).toBe(false);
      expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test(websiteUrl), websiteUrl).toBe(true);
    }
  });

  it('leaves a real research home out of the candidate set', () => {
    for (const websiteUrl of [
      'https://examplelab.yale.edu/',
      'https://timeperception.example.org/',
      'https://notnpr.example.org/lab/',
      'https://www.nytimes.com.evil.example/lab/',
      'https://examplelab.example.org/press/wsj.com-feature/',
    ]) {
      expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test(websiteUrl), websiteUrl).toBe(false);
    }
  });
});

describe('assertResearchEntityWebsiteUrlApplyAllowed', () => {
  it('allows dry-run without confirmation or limit', () => {
    expect(() =>
      assertResearchEntityWebsiteUrlApplyAllowed({
        dryRun: true,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('requires the confirmation flag for apply', () => {
    expect(() =>
      assertResearchEntityWebsiteUrlApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-research-entity-website-urls/);
  });

  it('requires an explicit limit for apply', () => {
    expect(() =>
      assertResearchEntityWebsiteUrlApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });

  it('permits apply with confirmation and an explicit limit', () => {
    expect(() =>
      assertResearchEntityWebsiteUrlApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: true,
      }),
    ).not.toThrow();
  });
});

describe('a roster page is refused as a person row research home (#2708)', () => {
  const MEMBERS_LIST = 'https://quantuminstitute.yale.edu/our-mission/our-members/';
  const LAB_MICROSITE = 'https://medicine.yale.edu/lab/example-lab/';

  it('flags a members list on a person-scoped row', () => {
    expect(
      isRosterPageWebsiteUrlForPerson(MEMBERS_LIST, { entityType: 'FACULTY_RESEARCH_AREA' }),
    ).toBe(true);
    expect(isRosterPageWebsiteUrlForPerson(MEMBERS_LIST, { entityType: 'LAB' })).toBe(true);
  });

  it('leaves the same page alone for the organisation that publishes it', () => {
    expect(isRosterPageWebsiteUrlForPerson(MEMBERS_LIST, { entityType: 'CENTER' })).toBe(false);
    expect(isRosterPageWebsiteUrlForPerson(MEMBERS_LIST, { entityType: 'INSTITUTE' })).toBe(false);
  });

  it('needs an entity type, and refuses nothing without one', () => {
    expect(isRosterPageWebsiteUrlForPerson(MEMBERS_LIST, undefined)).toBe(false);
    expect(isRosterPageWebsiteUrlForPerson(MEMBERS_LIST, {})).toBe(false);
  });

  it('does not flag a real research home', () => {
    expect(
      isRosterPageWebsiteUrlForPerson(LAB_MICROSITE, { entityType: 'FACULTY_RESEARCH_AREA' }),
    ).toBe(false);
  });

  it('makes the members list unpromotable on a person row but promotable for the centre', () => {
    expect(isPromotableWebsiteUrl(MEMBERS_LIST, { entityType: 'FACULTY_RESEARCH_AREA' })).toBe(
      false,
    );
    expect(isPromotableWebsiteUrl(MEMBERS_LIST, { entityType: 'CENTER' })).toBe(true);
  });

  it('keeps rather than sets when a person row cites only a roster page', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Example Person Faculty Research',
        sourceUrls: [MEMBERS_LIST],
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual({ action: 'keep' });
  });

  it('still picks the real research home when the row cites both', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Example Person Faculty Research',
        sourceUrls: [MEMBERS_LIST, LAB_MICROSITE],
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual({ action: 'set', websiteUrl: LAB_MICROSITE });
  });
});

describe('the promotion guard stays in lockstep with the repair predicate (#2708)', () => {
  // The churn loop this fixes is the two predicates disagreeing: the repair lane removes
  // a value the promotion path then restores. Parity is therefore the invariant worth
  // pinning, rather than either composition's internals. On constructible inputs
  // `isDepartmentRosterProvenanceUrl` subsumes `isSharedPeopleRosterUrl`, so a test of
  // the arms individually would leave one of them unpinned.
  const URLS = [
    'https://quantuminstitute.yale.edu/our-mission/our-members/',
    'https://example.yale.edu/people/',
    'https://example.yale.edu/our-people',
    'https://example.yale.edu/faculty/',
    'https://example.yale.edu/lab-members',
    'https://example.yale.edu/directory',
    'https://medicine.yale.edu/lab/example-lab/',
    'https://saltzman.eng.yale.edu/',
    'https://example.yale.edu/research/projects',
  ];

  for (const entityType of ['FACULTY_RESEARCH_AREA', 'LAB', 'CENTER', 'INSTITUTE']) {
    it(`agrees with isRosterPageCitedByPerson for ${entityType}`, () => {
      for (const url of URLS) {
        expect(isRosterPageWebsiteUrlForPerson(url, { entityType })).toBe(
          isRosterPageCitedByPerson(url, { entityType }),
        );
      }
    });
  }
});

describe('a department programme page is refused as a person row research home (#2708)', () => {
  const PROGRAMME =
    'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/';
  const LAB = 'https://medicine.yale.edu/lab/example-lab/';

  it('is not promotable on a person-scoped row', () => {
    expect(isPromotableWebsiteUrl(PROGRAMME, { entityType: 'FACULTY_RESEARCH_AREA' })).toBe(false);
    expect(isPromotableWebsiteUrl(PROGRAMME, { entityType: 'LAB' })).toBe(false);
  });

  it('stays promotable for the department that publishes it', () => {
    expect(isPromotableWebsiteUrl(PROGRAMME, { entityType: 'CENTER' })).toBe(true);
  });

  it('keeps rather than sets when a person row cites only a programme page', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Example Person Faculty Research',
        sourceUrls: [PROGRAMME],
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual({ action: 'keep' });
  });

  it('still picks the real research home when the row cites both', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Example Person Faculty Research',
        sourceUrls: [PROGRAMME, LAB],
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toEqual({ action: 'set', websiteUrl: LAB });
  });
});

describe('an umbrella page is refused as a person row research home (#2579)', () => {
  const GROUP_ROOT = 'http://het.yale.edu/';
  const DEPARTMENT_JOBS = 'http://economics.yale.edu/undergraduate/employment-opportunities';
  const LAB = 'https://ohernlab.yale.edu/';
  const PERSON = { entityType: 'FACULTY_RESEARCH_AREA', name: 'Example theorist research' };

  it('is not promotable into an empty slot on a person-scoped row', () => {
    expect(isPromotableWebsiteUrl(GROUP_ROOT, PERSON)).toBe(false);
    expect(isPromotableWebsiteUrl(DEPARTMENT_JOBS, PERSON)).toBe(false);
    expect(
      isPromotableWebsiteUrl(GROUP_ROOT, { entityType: 'CENTER', name: 'Particle Theory' }),
    ).toBe(true);
  });

  it('keeps rather than re-fills an empty slot from a group root citation', () => {
    expect(
      resolveBackfillWebsiteUrl({ ...PERSON, sourceUrls: [GROUP_ROOT, DEPARTMENT_JOBS] }),
    ).toEqual({ action: 'keep' });
  });

  it('clears a stored group root instead of keeping it, so the repair is not undone', () => {
    expect(
      resolveBackfillWebsiteUrl({ ...PERSON, websiteUrl: GROUP_ROOT, sourceUrls: [GROUP_ROOT] }),
    ).toEqual({ action: 'clear' });
    expect(resolveBackfillWebsiteUrl({ ...PERSON, websiteUrl: DEPARTMENT_JOBS })).toEqual({
      action: 'clear',
    });
  });

  it('re-picks the real research home when the row also cites one', () => {
    expect(
      resolveBackfillWebsiteUrl({ ...PERSON, websiteUrl: GROUP_ROOT, sourceUrls: [LAB] }),
    ).toEqual({ action: 'set', websiteUrl: LAB });
  });

  it('leaves the group root stored on the organizational row that owns it', () => {
    expect(
      resolveBackfillWebsiteUrl({
        entityType: 'CENTER',
        name: 'Particle Theory Group',
        websiteUrl: GROUP_ROOT,
      }),
    ).toEqual({ action: 'keep' });
  });
});

describe('an organization whose only citation is a page inside its own site (#2534)', () => {
  it('derives the host root for a centre citing nothing but its own people page', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Tobin Center for Economic Policy',
        entityType: 'CENTER',
        websiteUrl: '',
        sourceUrls: ['https://tobin.yale.edu/people'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://tobin.yale.edu/' });
  });

  it('derives the owned subtree for a centre hosted under a school', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Yale Center for Genome Analysis',
        entityType: 'CENTER',
        sourceUrls: ['https://medicine.yale.edu/genetics/research/ycga/people/'],
      }),
    ).toEqual({
      action: 'set',
      websiteUrl: 'https://medicine.yale.edu/genetics/research/ycga/',
    });
  });

  it('replaces a roster page stored as an institute website with the site it belongs to', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Quantitative Biology Institute',
        displayName: 'QBio',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://qbio.yale.edu/members',
        sourceUrls: ['https://qbio.yale.edu/members'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://qbio.yale.edu/' });
  });

  it('prefers the organization site over its own roster page', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Whitney Humanities Center',
        entityType: 'CENTER',
        sourceUrls: ['https://whc.yale.edu/leadership-and-staff'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://whc.yale.edu/' });
  });

  it('leaves a centre citing a host its name does not spell with no website', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Cowles Foundation for Research in Economics',
        entityType: 'CENTER',
        sourceUrls: ['https://egc.yale.edu/people/faculty'],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('keeps a roster page as a website when no owned site can be derived from it', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Cowles Foundation for Research in Economics',
        entityType: 'CENTER',
        sourceUrls: ['https://egc.yale.edu/leadership-and-staff'],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://egc.yale.edu/leadership-and-staff' });
  });

  it('lets a real research home in the evidence beat the derived site', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Examplecenter',
        entityType: 'CENTER',
        websiteUrl: 'https://examplecenter.yale.edu/people/members/',
        sourceUrls: [
          'https://examplecenter.yale.edu/people/members/',
          'https://examplecenter.yale.edu/labs/imaging/',
        ],
      }),
    ).toEqual({ action: 'set', websiteUrl: 'https://examplecenter.yale.edu/labs/imaging/' });
  });

  // The fallback decides whose site a host is. It must not also decide that a page
  // which can never be a research home has become one (#2460, #2285).
  it('clears rather than deriving a site from a citation that can never be a home', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Examplecenter',
        entityType: 'CENTER',
        websiteUrl: 'https://ysph.yale.edu/examplecenter/giving/charitable-funds/',
        sourceUrls: ['https://ysph.yale.edu/examplecenter/giving/charitable-funds/'],
      }),
    ).toEqual({ action: 'clear' });
  });

  // The refusals inside the derivation judge the CITATION. This judges the URL the
  // derivation produced, which is a different string and can be a page no entity may
  // ever serve as its research home: the citation check passes
  // `https://ysph.yale.edu/news/examplecenter/people/`, and only the re-check refuses
  // the `https://ysph.yale.edu/news/examplecenter/` it derives from it.
  it('refuses a derived site whose own prefix is a newsroom', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Examplecenter',
        entityType: 'CENTER',
        sourceUrls: ['https://ysph.yale.edu/news/examplecenter/people/'],
      }),
    ).toEqual({ action: 'keep' });
  });

  it('leaves a centre whose name merely mentions a school with no website', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Yale Center for Precision Medicine',
        entityType: 'CENTER',
        websiteUrl: 'https://medicine.yale.edu/genetics/people/',
        sourceUrls: ['https://medicine.yale.edu/genetics/people/'],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('leaves a person-scoped row on the same citation with no website at all', () => {
    expect(
      resolveBackfillWebsiteUrl({
        name: 'Examplegroup',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://examplegroup.yale.edu/people/members/',
        sourceUrls: ['https://examplegroup.yale.edu/people/members/'],
      }),
    ).toEqual({ action: 'clear' });
  });
});
