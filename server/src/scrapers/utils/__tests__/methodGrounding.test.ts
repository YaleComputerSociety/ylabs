import { describe, expect, it } from 'vitest';
import { groundMethods, isMethodGroundedInText } from '../methodGrounding';

describe('isMethodGroundedInText', () => {
  const text = 'We use functional MRI and single-cell RNA sequencing to study cortical circuits.';

  it('keeps a method whose significant words all appear in the source', () => {
    expect(isMethodGroundedInText('functional MRI', text)).toBe(true);
    expect(isMethodGroundedInText('single-cell RNA sequencing', text)).toBe(true);
  });

  it('allows reordering and stopword differences', () => {
    expect(isMethodGroundedInText('MRI (functional)', text)).toBe(true);
  });

  it('rejects a fabricated method not present in the source', () => {
    expect(isMethodGroundedInText('mass spectrometry', text)).toBe(false);
  });

  it('rejects content-free phrases', () => {
    expect(isMethodGroundedInText('research methods', text)).toBe(false);
    expect(isMethodGroundedInText('various techniques', text)).toBe(false);
    expect(isMethodGroundedInText('methods and techniques', text)).toBe(false);
  });
});

describe('groundMethods', () => {
  const text = 'Techniques include CRISPR screening, live-cell imaging, and flow cytometry.';

  it('returns only grounded, de-duplicated methods within the limit', () => {
    const result = groundMethods(
      ['CRISPR screening', 'crispr screening', 'live-cell imaging', 'fabricated assay'],
      text,
    );
    expect(result).toEqual(['CRISPR screening', 'live-cell imaging']);
  });

  it('caps the number of returned methods', () => {
    const many = Array.from({ length: 20 }, (_, i) => `flow cytometry ${i}`);
    expect(groundMethods(many, `${text} ${many.join(' ')}`, 5)).toHaveLength(5);
  });

  it('returns an empty array for non-array input', () => {
    expect(groundMethods(undefined, text)).toEqual([]);
    expect(groundMethods('flow cytometry', text)).toEqual([]);
  });
});
