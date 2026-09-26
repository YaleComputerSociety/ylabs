import { describe, expect, it } from 'vitest';
import {
  isNonIdentifyingDescriptionSourceUrl,
  isSiteSearchResultUrl,
} from '../sources/labMicrositeDescriptionLLMExtractor';

/**
 * The hosts are institutional because the corpus says so, not because of their names, so
 * the fixture states the set rather than relying on a pattern (`institutionalEvidenceHosts`
 * derives it from rows citing them).
 */
const corpus = {
  institutionalHosts: new Set(['example-school.edu', 'example-health.edu']),
};

describe('isSiteSearchResultUrl', () => {
  it('catches the redirect shape #3494 measured: a search term carrying the entity name', () => {
    expect(
      isSiteSearchResultUrl(
        'https://example-school.edu/search?redirected&search_term=profile%20example%20person',
      ),
    ).toBe(true);
  });

  it('catches the other spellings a host uses for the same page', () => {
    for (const url of [
      'https://example-school.edu/?s=example+person',
      'https://example-school.edu/site-search?q=example',
      'https://example-school.edu/find?query=example',
      'https://example-school.edu/x?keywords=example',
    ]) {
      expect(isSiteSearchResultUrl(url), url).toBe(true);
    }
  });

  it('leaves an ordinary page alone, including one with an unrelated query', () => {
    for (const url of [
      'https://example-school.edu/profile/example-person/',
      'https://example-lab.org/research',
      'https://example-school.edu/people/example-person?tab=publications',
      'https://example-school.edu/search-committee/members',
    ]) {
      expect(isSiteSearchResultUrl(url), url).toBe(false);
    }
  });

  it('is false on a non-URL rather than throwing', () => {
    expect(isSiteSearchResultUrl('not a url')).toBe(false);
    expect(isSiteSearchResultUrl(undefined)).toBe(false);
  });
});

describe('isNonIdentifyingDescriptionSourceUrl', () => {
  it('refuses a school-wide research landing page, the page read for three separate rows', () => {
    expect(
      isNonIdentifyingDescriptionSourceUrl('https://example-health.edu/research/', corpus),
    ).toBe(true);
  });

  it('keeps a page several rows cite, because shared evidence is a NAME question not a description one', () => {
    // A professor's own profile page is legitimately cited by their lab row and their
    // faculty-research row and is the correct description source for both. Measured on
    // Development: adding isSharedEvidenceUrl here refused 1,223 of 9,336 candidate URLs
    // and stripped every candidate from 414 rows, 35 of them served (#3494).
    expect(
      isNonIdentifyingDescriptionSourceUrl('https://example-school.edu/faculty-directory', corpus),
    ).toBe(false);
  });

  it('refuses the search-results redirect target', () => {
    expect(
      isNonIdentifyingDescriptionSourceUrl(
        'https://example-school.edu/search?search_term=example%20person',
        corpus,
      ),
    ).toBe(true);
  });

  it('keeps a named unit several segments deep on the same institutional host', () => {
    expect(
      isNonIdentifyingDescriptionSourceUrl(
        'https://example-health.edu/internal-medicine/genmed/example-centre/',
        corpus,
      ),
    ).toBe(false);
  });

  it("keeps a lab microsite's own research page, because its host is not institutional", () => {
    expect(
      isNonIdentifyingDescriptionSourceUrl('https://examplelab.example.edu/research', corpus),
    ).toBe(false);
  });

  it('keeps a person profile on an institutional host, which is the lane s ordinary input', () => {
    expect(
      isNonIdentifyingDescriptionSourceUrl(
        'https://example-health.edu/profile/example-person/',
        corpus,
      ),
    ).toBe(false);
  });

  it('tolerates an empty corpus rather than refusing everything', () => {
    expect(
      isNonIdentifyingDescriptionSourceUrl('https://example-health.edu/research/', {
        institutionalHosts: undefined,
      } as never),
    ).toBe(false);
  });
});
