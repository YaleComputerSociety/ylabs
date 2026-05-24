import { describe, expect, it } from 'vitest';
import {
  httpUrlHasHostSuffix,
  isHttpUrl,
  normalizedHostMatchesSuffix,
  parseNormalizedHttpUrl,
} from '../urlNormalization';

describe('urlNormalization', () => {
  it('normalizes HTTP URL host and path fields used by public URL filters', () => {
    expect(
      parseNormalizedHttpUrl(
        ' HTTPS://WWW.Engineering.Yale.edu/research-and-faculty/faculty-directory/Jane-Doe/// ',
      ),
    ).toMatchObject({
      href: 'https://www.engineering.yale.edu/research-and-faculty/faculty-directory/Jane-Doe///',
      host: 'engineering.yale.edu',
      path: '/research-and-faculty/faculty-directory/jane-doe',
    });
  });

  it('rejects non-string, malformed, and non-HTTP URLs without throwing', () => {
    expect(parseNormalizedHttpUrl(undefined)).toBeUndefined();
    expect(parseNormalizedHttpUrl('not a url')).toBeUndefined();
    expect(parseNormalizedHttpUrl('mailto:someone@yale.edu')).toBeUndefined();
  });

  it('provides a shared HTTP URL predicate for callers that only need validation', () => {
    expect(isHttpUrl(' https://yale.edu/research ')).toBe(true);
    expect(isHttpUrl('HTTP://YALE.EDU/research')).toBe(true);
    expect(isHttpUrl('ftp://yale.edu/research')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('matches host suffixes without accepting lookalike domains', () => {
    expect(normalizedHostMatchesSuffix('anthropology.yale.edu', 'yale.edu')).toBe(true);
    expect(normalizedHostMatchesSuffix('www.yale.edu', 'yale.edu')).toBe(true);
    expect(normalizedHostMatchesSuffix('notyale.edu', 'yale.edu')).toBe(false);
    expect(httpUrlHasHostSuffix('https://medicine.yale.edu/profile/example', 'yale.edu')).toBe(
      true,
    );
    expect(httpUrlHasHostSuffix('https://notyale.edu/profile/example', 'yale.edu')).toBe(false);
  });
});
