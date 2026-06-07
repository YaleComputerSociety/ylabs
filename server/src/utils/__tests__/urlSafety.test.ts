import { describe, expect, it } from 'vitest';

import { isPublicHttpUrl } from '../urlSafety';

describe('urlSafety', () => {
  it('rejects credentialed HTTP URLs as non-public', () => {
    expect(isPublicHttpUrl('https://example.yale.edu/apply')).toBe(true);
    expect(isPublicHttpUrl('http://example.yale.edu/apply')).toBe(true);
    expect(isPublicHttpUrl('https://user:pass@example.yale.edu/private')).toBe(false);
    expect(isPublicHttpUrl('mailto:program@yale.edu')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(document.cookie)')).toBe(false);
  });
});
