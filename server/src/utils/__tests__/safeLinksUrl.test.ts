import { describe, it, expect } from 'vitest';
import { unwrapMicrosoftSafeLinksUrl } from '../safeLinksUrl';

describe('unwrapMicrosoftSafeLinksUrl', () => {
  it('unwraps an Outlook safelinks wrapper to its inner target', () => {
    const wrapped =
      'https://nam12.safelinks.protection.outlook.com/?url=http%3A%2F%2Fwww.morganroster.com%2F&data=05%7C01%7C&sdata=abc&reserved=0';
    expect(unwrapMicrosoftSafeLinksUrl(wrapped)).toBe('http://www.morganroster.com/');
  });

  it('unwraps a safelinks wrapper around an https target', () => {
    const wrapped =
      'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fmuse.jhu.edu%2Farticle%2F963779&data=1';
    expect(unwrapMicrosoftSafeLinksUrl(wrapped)).toBe('https://muse.jhu.edu/article/963779');
  });

  it('returns a plain URL unchanged', () => {
    expect(unwrapMicrosoftSafeLinksUrl('https://filmstudies.yale.edu/people/faculty')).toBe(
      'https://filmstudies.yale.edu/people/faculty',
    );
  });

  it('leaves a safelinks wrapper without a url param unchanged', () => {
    const wrapped = 'https://nam12.safelinks.protection.outlook.com/?data=05%7C01';
    expect(unwrapMicrosoftSafeLinksUrl(wrapped)).toBe(wrapped);
  });

  it('ignores a non-http inner target rather than emitting a bogus scheme', () => {
    const wrapped =
      'https://nam12.safelinks.protection.outlook.com/?url=mailto%3Asomeone%40yale.edu';
    expect(unwrapMicrosoftSafeLinksUrl(wrapped)).toBe(wrapped);
  });

  it('handles non-string and empty input', () => {
    expect(unwrapMicrosoftSafeLinksUrl(undefined)).toBe('');
    expect(unwrapMicrosoftSafeLinksUrl(null)).toBe('');
    expect(unwrapMicrosoftSafeLinksUrl('   ')).toBe('');
  });

  it('unwraps a doubly-wrapped safelinks target', () => {
    const inner =
      'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fx';
    const outer =
      'https://nam12.safelinks.protection.outlook.com/?url=' + encodeURIComponent(inner);
    expect(unwrapMicrosoftSafeLinksUrl(outer)).toBe('https://example.com/x');
  });
});
