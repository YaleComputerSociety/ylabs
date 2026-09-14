import { describe, expect, it } from 'vitest';
import { supersedesOfficialProfileUrl } from '../backfillResearcherOfficialProfileLinksCore';

/**
 * These cases were written against `repairSupersededOfficialProfileLinks`, which was
 * retired in #2653 because `entityMaterializer` performs the same replacement from
 * the same predicate. They live here now, next to the predicate's owner, so retiring
 * the script did not take the engine's only coverage of it with it.
 */

describe('supersedesOfficialProfileUrl', () => {
  it('accepts a same-host move from a directory path onto the CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(true);
  });

  it('accepts a move onto a section-nested CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example-dept.yale.edu/faculty/profile/ada-example',
      ),
    ).toBe(true);
  });

  it('never moves back off the CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/people/ada-example',
      ),
    ).toBe(false);
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/faculty/profile/ada-example',
        'https://example-dept.yale.edu/people/ada-example',
      ),
    ).toBe(false);
  });

  it('leaves a link from another host alone', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://other-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('treats two CMS profile pages on one host as no change', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/profile/ada-example-2',
      ),
    ).toBe(false);
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/faculty/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('ignores an identical path that differs only by trailing slash', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example/',
        'https://example-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('ignores non-Yale and unparseable candidates', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example.com/profile/ada-example',
      ),
    ).toBe(false);
    expect(supersedesOfficialProfileUrl('not a url', 'also not a url')).toBe(false);
  });
});
