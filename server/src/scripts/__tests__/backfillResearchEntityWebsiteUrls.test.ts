import { describe, expect, it } from 'vitest';
import {
  isContentPageUrl,
  isGrantOrIdentifierUrl,
  isListingPageWebsiteUrl,
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
