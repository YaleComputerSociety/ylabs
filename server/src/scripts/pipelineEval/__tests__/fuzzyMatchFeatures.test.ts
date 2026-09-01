import { describe, expect, it } from 'vitest';
import {
  compareEntities,
  cosine,
  doubleMetaphone,
  firstNameCompatibility,
  jaccard,
  jaroWinkler,
  metaphone,
  piOverlap,
  softTfIdf,
  tokenSetRatio,
  tokenSortRatio,
} from '../fuzzyMatchFeatures';

describe('jaroWinkler', () => {
  it('scores a classic transposition near 0.96', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.94);
    expect(jaroWinkler('martha', 'marhta')).toBeLessThan(0.99);
  });
  it('is 1 for identical non-empty and 0 for disjoint', () => {
    expect(jaroWinkler('smith', 'smith')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
});

describe('token ratios', () => {
  it('tokenSetRatio ignores word order and extra tokens', () => {
    expect(tokenSetRatio('smith lab', 'lab smith')).toBe(1);
    expect(tokenSetRatio('smith lab', 'lab smith extra')).toBe(1);
  });
  it('tokenSortRatio ignores word order', () => {
    expect(tokenSortRatio('ruiz laboratory', 'laboratory ruiz')).toBe(1);
  });
});

describe('metaphone / doubleMetaphone', () => {
  it('encodes Smith and Smyth identically', () => {
    expect(metaphone('Smith')).toBe(metaphone('Smyth'));
    expect(metaphone('Smith')).not.toBe('');
    expect(doubleMetaphone('Smith').primary).toBe(doubleMetaphone('Smyth').primary);
  });
  it('distinguishes clearly different surnames', () => {
    expect(metaphone('Smith')).not.toBe(metaphone('Johnson'));
  });
});

describe('firstNameCompatibility', () => {
  it('treats an initial matching a full name as initial-compatible', () => {
    expect(firstNameCompatibility('J. Smith', 'Jane Smith')).toBe('initial-compatible');
    expect(firstNameCompatibility('J', 'Jane')).toBe('initial-compatible');
  });
  it('treats two different full first names as conflicting', () => {
    expect(firstNameCompatibility('John Smith', 'Jane Smith')).toBe('conflicting');
    expect(firstNameCompatibility('John', 'Robert')).toBe('conflicting');
  });
  it('treats identical first names as shared', () => {
    expect(firstNameCompatibility('Jane Smith', 'Jane Doe')).toBe('shared');
  });
});

describe('jaccard', () => {
  it('computes intersection over union', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(0.5, 6);
  });
  it('is 0 for two empty sets', () => {
    expect(jaccard([], [])).toBe(0);
  });
});

describe('cosine', () => {
  it('is 1 for parallel and 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 6);
  });
});

describe('softTfIdf', () => {
  it('weights a shared rare token higher than a shared common token', () => {
    const idf = new Map([
      ['rare', 10],
      ['common', 1],
    ]);
    const rare = softTfIdf(['rare', 'x'], ['rare', 'y'], idf);
    const common = softTfIdf(['common', 'x'], ['common', 'y'], idf);
    expect(rare).toBeGreaterThan(common);
  });
});

describe('piOverlap', () => {
  it('returns a positive weight only when a person id is shared', () => {
    expect(piOverlap([{ personId: 'p1' }], [{ personId: 'p1' }])).toBe(1);
    expect(piOverlap([{ personId: 'p1' }], [{ personId: 'p2' }])).toBe(0);
    expect(piOverlap([{ personId: 'p1', confidence: 0.5 }], [{ personId: 'p1' }])).toBe(0.5);
  });
});

describe('compareEntities', () => {
  it('flags a same-person cross-department pair as strongly similar', () => {
    const features = compareEntities(
      {
        name: 'Ruiz Laboratory',
        surname: 'Ruiz',
        departments: ['Neuroscience'],
        websiteUrl: 'https://ruizlab.example.edu/',
        pi: [{ personId: 'person-1' }],
      },
      {
        name: 'Ruiz Lab',
        surname: 'Ruiz',
        departments: ['Psychiatry'],
        websiteUrl: 'https://ruizlab.example.edu/people',
        pi: [{ personId: 'person-1' }],
      },
    );
    expect(features.surnameMetaphoneMatch).toBe(true);
    expect(features.hostMatch).toBe(true);
    expect(features.piOverlap).toBe(1);
  });
  it('does not over-score a namesake pair with different first names and no shared signals', () => {
    const features = compareEntities(
      { name: 'John Chen Lab', firstName: 'John', departments: ['Physics'] },
      { name: 'Jane Chen Lab', firstName: 'Jane', departments: ['Chemistry'] },
    );
    expect(features.firstNameCompatibility).toBe('conflicting');
    expect(features.hostMatch).toBe(false);
    expect(features.piOverlap).toBe(0);
    expect(features.departmentJaccard).toBe(0);
  });
});
