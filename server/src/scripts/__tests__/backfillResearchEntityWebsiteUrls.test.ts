import { describe, expect, it } from 'vitest';
import {
  isContentPageUrl,
  isGrantOrIdentifierUrl,
  isProfilePageWebsiteUrl,
  isPromotableWebsiteUrl,
  isPublicHttpUrl,
  selectBackfillWebsiteUrl,
  selectCorrectiveWebsiteUrl,
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
});

describe('profile-page website URL exclusion', () => {
  it('flags Yale profile, faculty-directory, and people-directory pages', () => {
    expect(isProfilePageWebsiteUrl('https://medicine.yale.edu/profile/pat-fixture/')).toBe(true);
    expect(
      isProfilePageWebsiteUrl(
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
      ),
    ).toBe(true);
    expect(isProfilePageWebsiteUrl('https://english.yale.edu/people/kai-fixture/')).toBe(true);
    expect(isProfilePageWebsiteUrl('https://environment.yale.edu/directory/faculty/sam-fixture/')).toBe(
      true,
    );
    expect(isProfilePageWebsiteUrl('https://synthlab.yale.edu/')).toBe(false);
    expect(isProfilePageWebsiteUrl('reporter.nih.gov/project/1')).toBe(false);
  });

  it('never treats a profile or faculty-directory page as promotable', () => {
    expect(isPromotableWebsiteUrl('https://medicine.yale.edu/profile/pat-fixture/')).toBe(false);
    expect(
      isPromotableWebsiteUrl(
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
      ),
    ).toBe(false);
    expect(isPromotableWebsiteUrl('https://english.yale.edu/people/kai-fixture/')).toBe(false);
    expect(isPromotableWebsiteUrl('https://synthlab.yale.edu/')).toBe(true);
  });

  it('prefers a real lab site over a profile page regardless of ordering', () => {
    expect(
      selectBackfillWebsiteUrl({
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
          'https://synthlab.example.org/',
        ],
      }),
    ).toBe('https://synthlab.example.org/');
  });

  it('leaves websiteUrl unset when every candidate is a profile page', () => {
    expect(
      selectBackfillWebsiteUrl({
        sourceUrls: [
          'https://medicine.yale.edu/profile/pat-fixture/',
          'https://english.yale.edu/people/kai-fixture/',
        ],
      }),
    ).toBeUndefined();
  });
});

describe('selectCorrectiveWebsiteUrl', () => {
  it('demotes an already-wrong profile websiteUrl in favor of a real lab site', () => {
    expect(
      selectCorrectiveWebsiteUrl({
        websiteUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://synthlab.example.org/',
        ],
      }),
    ).toBe('https://synthlab.example.org/');
  });

  it('prefers the website field over sourceUrls when correcting', () => {
    expect(
      selectCorrectiveWebsiteUrl({
        websiteUrl: 'https://medicine.yale.edu/profile/pat-fixture/',
        website: 'https://synthlab.yale.edu/',
        sourceUrls: ['https://another.example.org/'],
      }),
    ).toBe('https://synthlab.yale.edu/');
  });

  it('returns undefined when the current websiteUrl is already a real lab site', () => {
    expect(
      selectCorrectiveWebsiteUrl({
        websiteUrl: 'https://synthlab.yale.edu/',
        sourceUrls: ['https://another.example.org/'],
      }),
    ).toBeUndefined();
  });

  it('returns undefined when a profile websiteUrl has no better candidate', () => {
    expect(
      selectCorrectiveWebsiteUrl({
        websiteUrl: 'https://medicine.yale.edu/profile/pat-fixture/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/1',
          'https://english.yale.edu/people/kai-fixture/',
        ],
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
