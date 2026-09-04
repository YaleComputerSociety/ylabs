import { describe, expect, it } from 'vitest';
import {
  isBoilerplateHostWebsiteUrl,
  isContentPageUrl,
  isFileShareOrDocumentWebsiteUrl,
  isGrantOrIdentifierUrl,
  isListingPageWebsiteUrl,
  isMultiTenantHostRootWebsiteUrl,
  isProfilePageWebsiteUrl,
  isPromotableWebsiteUrl,
  isPublicHttpUrl,
  resolveBackfillWebsiteUrl,
  selectBackfillWebsiteUrl,
} from '../backfillResearchEntityWebsiteUrlsCore';
import {
  assertResearchEntityWebsiteUrlApplyAllowed,
  parseResearchEntityWebsiteUrlBackfillArgs,
} from '../backfillResearchEntityWebsiteUrls';

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
