import { describe, expect, it } from 'vitest';

import { isPublicHttpUrl, publicHttpUrl } from '../urlSafety';

describe('urlSafety', () => {
  it('rejects credentialed HTTP URLs as non-public', () => {
    expect(isPublicHttpUrl('https://example.yale.edu/apply')).toBe(true);
    expect(isPublicHttpUrl('http://example.yale.edu/apply')).toBe(true);
    expect(isPublicHttpUrl('https://user:pass@example.yale.edu/private')).toBe(false);
    expect(isPublicHttpUrl('mailto:program@yale.edu')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isPublicHttpUrl('https://example.yale.edu/apply\nhttps://evil.example')).toBe(false);
    expect(isPublicHttpUrl('https:\\\\evil.example\\phish')).toBe(false);
    expect(isPublicHttpUrl('https://example.yale.edu/apply here')).toBe(false);
  });

  it('rejects oversized URL values before parsing or normalization', () => {
    const oversized = `https://example.yale.edu/${'a'.repeat(2049)}`;

    expect(isPublicHttpUrl(oversized)).toBe(false);
    expect(publicHttpUrl(oversized)).toBeUndefined();
  });
});
