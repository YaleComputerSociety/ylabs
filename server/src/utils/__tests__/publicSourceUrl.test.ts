import { describe, expect, it } from 'vitest';
import {
  isForbiddenEngineeringSourceUrl,
  isPubliclyExposableSourceUrl,
  publicSourceUrl,
  publicSourceUrls,
} from '../publicSourceUrl';

describe('publicSourceUrl', () => {
  it('blocks engineering faculty-directory pages that should not be exposed as public evidence', () => {
    const url =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';

    expect(isForbiddenEngineeringSourceUrl(url)).toBe(true);
    expect(isPubliclyExposableSourceUrl(url)).toBe(false);
    expect(publicSourceUrl(url)).toBeUndefined();
  });

  it('keeps ordinary HTTP URLs and drops invalid values from public URL lists', () => {
    expect(publicSourceUrl(' https://medicine.yale.edu/lab/example/ ')).toBe(
      'https://medicine.yale.edu/lab/example/',
    );
    expect(publicSourceUrls(['not-a-url', undefined, 'https://yale.edu/research'])).toEqual([
      'https://yale.edu/research',
    ]);
  });

  it('rejects URLs with embedded control whitespace before public exposure', () => {
    expect(publicSourceUrl('https://yale.edu\n.evil.example/source')).toBeUndefined();
    expect(publicSourceUrls(['https://yale.edu\t.evil.example/source'])).toEqual([]);
  });
});
