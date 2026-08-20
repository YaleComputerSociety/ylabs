import { describe, expect, it } from 'vitest';
import {
  GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX,
  isGrantOnlyShell,
} from '../researchHomeGrantOnlyShellCore';

describe('isGrantOnlyShell', () => {
  it('flags an entity whose only evidence is a grant/identifier host', () => {
    expect(
      isGrantOnlyShell({
        websiteUrl: '',
        sourceUrls: ['https://reporter.nih.gov/project-details/123'],
      }),
    ).toBe(true);
    expect(
      isGrantOnlyShell({
        sourceUrls: ['https://www.nsf.gov/awardsearch/x', 'https://orcid.org/0000-0000-0000-0000'],
      }),
    ).toBe(true);
    expect(
      isGrantOnlyShell({
        website: 'https://scholar.google.com/citations?user=x',
        sourceUrls: [],
      }),
    ).toBe(true);
  });

  it('does not flag an entity that already has a usable official websiteUrl', () => {
    expect(
      isGrantOnlyShell({
        websiteUrl: 'https://medicine.yale.edu/lab/smith/',
        sourceUrls: ['https://reporter.nih.gov/project-details/123'],
      }),
    ).toBe(false);
  });

  it('does not flag an entity that carries a promotable official URL the zero-network lane can fill', () => {
    expect(
      isGrantOnlyShell({
        websiteUrl: '',
        website: 'https://lab.yale.edu/',
        sourceUrls: ['https://reporter.nih.gov/project-details/123'],
      }),
    ).toBe(false);
    expect(
      isGrantOnlyShell({
        sourceUrls: ['https://reporter.nih.gov/project-details/1', 'https://centers.yale.edu/x/'],
      }),
    ).toBe(false);
  });

  it('does not flag a shell with no grant/identifier evidence at all', () => {
    expect(isGrantOnlyShell({ websiteUrl: '', sourceUrls: [] })).toBe(false);
    expect(
      isGrantOnlyShell({ websiteUrl: '', sourceUrls: ['https://lab.yale.edu/news/story'] }),
    ).toBe(false);
  });

  it('does not treat a content page as an official URL that disqualifies the shell', () => {
    expect(
      isGrantOnlyShell({
        websiteUrl: '',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/9',
          'https://lab.yale.edu/news/breakthrough/',
        ],
      }),
    ).toBe(true);
  });

  it('is not fooled by grant-host lookalike domains', () => {
    expect(
      isGrantOnlyShell({ websiteUrl: '', sourceUrls: ['https://nih.gov.evil.example/lab'] }),
    ).toBe(false);
  });
});

describe('GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX', () => {
  it('matches the grant/identifier hosts used as the coarse Mongo pre-filter', () => {
    expect(GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX.test('https://reporter.nih.gov/x')).toBe(true);
    expect(GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX.test('https://www.nsf.gov/awardsearch')).toBe(true);
    expect(GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX.test('https://orcid.org/0000-0000-0000-0000')).toBe(
      true,
    );
    expect(GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX.test('https://scholar.google.com/citations')).toBe(
      true,
    );
    expect(GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX.test('https://doi.org/10.1000/xyz')).toBe(true);
    expect(GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX.test('https://medicine.yale.edu/lab/')).toBe(false);
  });
});
