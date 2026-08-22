import { describe, it, expect } from 'vitest';
import {
  givenNamesEquivalent,
  givenNameVariants,
  surnameCoreKey,
  surnameFetchRegex,
  surnamesCompatible,
  surnameOnlyMatch,
} from '../piNameMatch';

describe('givenNamesEquivalent', () => {
  it('treats identical given names as equivalent (case-insensitive)', () => {
    expect(givenNamesEquivalent('Robert', 'robert')).toBe(true);
  });

  it('treats canonical nickname / formal-name pairs as equivalent', () => {
    expect(givenNamesEquivalent('Bob', 'Robert')).toBe(true);
    expect(givenNamesEquivalent('Robert', 'Bob')).toBe(true);
    expect(givenNamesEquivalent('Bill', 'William')).toBe(true);
    expect(givenNamesEquivalent('Jim', 'James')).toBe(true);
  });

  it('treats additional canonical diminutives as equivalent', () => {
    expect(givenNamesEquivalent('Jenn', 'Jennifer')).toBe(true);
    expect(givenNamesEquivalent('Jennifer', 'Jenn')).toBe(true);
    expect(givenNamesEquivalent('Candie', 'Candice')).toBe(true);
    expect(givenNamesEquivalent('Candace', 'Candie')).toBe(true);
  });

  it('does not equate distinct given names that merely share an initial', () => {
    expect(givenNamesEquivalent('Amy', 'Amelia')).toBe(false);
    expect(givenNamesEquivalent('John', 'Jane')).toBe(false);
    expect(givenNamesEquivalent('Francis', 'Frederick')).toBe(false);
    expect(givenNamesEquivalent('Leying', 'Lawrence')).toBe(false);
  });

  it('compares only the leading given token', () => {
    expect(givenNamesEquivalent('Bob Allen', 'Robert')).toBe(true);
  });

  it('returns false on blank input', () => {
    expect(givenNamesEquivalent('', 'Robert')).toBe(false);
    expect(givenNamesEquivalent('Robert', '')).toBe(false);
  });
});

describe('givenNameVariants', () => {
  it('expands a nickname to its canonical group (including itself)', () => {
    const variants = givenNameVariants('Bob');
    expect(variants).toContain('bob');
    expect(variants).toContain('robert');
    expect(variants).toContain('rob');
  });

  it('returns only the name itself when it has no nickname mapping', () => {
    expect(givenNameVariants('Parker')).toEqual(['parker']);
    expect(givenNameVariants('Leying')).toEqual(['leying']);
  });

  it('returns an empty list for blank input', () => {
    expect(givenNameVariants('')).toEqual([]);
  });
});

describe('surnameCoreKey', () => {
  it('drops leading particles down to the identifying token', () => {
    expect(surnameCoreKey('van der Berg')).toBe('berg');
    expect(surnameCoreKey('de la Cruz')).toBe('cruz');
    expect(surnameCoreKey('Berg')).toBe('berg');
  });

  it('uses the trailing token of a compound / hyphenated surname', () => {
    expect(surnameCoreKey('Watkins-Colwell')).toBe('colwell');
  });

  it('is empty for blank input', () => {
    expect(surnameCoreKey('')).toBe('');
  });
});

describe('surnameFetchRegex', () => {
  it('matches the stored surname whether or not it carries leading particles', () => {
    const re = surnameFetchRegex('Berg')!;
    expect(re.test('van der Berg')).toBe(true);
    expect(re.test('Berg')).toBe(true);
  });

  it('does not match an unrelated surname that merely ends in the same letters', () => {
    const re = surnameFetchRegex('Berg')!;
    expect(re.test('Rosenberg')).toBe(false);
    expect(re.test('Berger')).toBe(false);
    expect(re.test('iceberg')).toBe(false);
  });

  it('returns null when there is no usable surname token', () => {
    expect(surnameFetchRegex('')).toBeNull();
  });
});

describe('surnamesCompatible', () => {
  it('matches identical surnames', () => {
    expect(surnamesCompatible('Smith', 'Smith')).toBe(true);
    expect(surnamesCompatible('van der Berg', 'van der Berg')).toBe(true);
  });

  it('matches a particle-dropped surname against its full form (both directions)', () => {
    expect(surnamesCompatible('Berg', 'van der Berg')).toBe(true);
    expect(surnamesCompatible('van der Berg', 'Berg')).toBe(true);
    expect(surnamesCompatible('Cruz', 'de la Cruz')).toBe(true);
  });

  it('matches a compound surname against its trailing part (both directions)', () => {
    expect(surnamesCompatible('Colwell', 'Watkins-Colwell')).toBe(true);
    expect(surnamesCompatible('Watkins-Colwell', 'Colwell')).toBe(true);
  });

  it('does NOT match two surnames whose particles both differ', () => {
    expect(surnamesCompatible('von Berg', 'van der Berg')).toBe(false);
  });

  it('does NOT match different surnames or near-misses', () => {
    expect(surnamesCompatible('Berg', 'Berger')).toBe(false);
    expect(surnamesCompatible('Smith', 'Jones')).toBe(false);
    expect(surnamesCompatible('Berg', 'Rosenberg')).toBe(false);
  });

  it('returns false on blank input', () => {
    expect(surnamesCompatible('', 'Smith')).toBe(false);
    expect(surnamesCompatible('Smith', '')).toBe(false);
  });
});

describe('surnameOnlyMatch', () => {
  it('resolves a surname-only name only when exactly one candidate exists', () => {
    expect(surnameOnlyMatch(1)).toBe('matched');
  });

  it('fails closed to ambiguous when a surname is shared by several faculty', () => {
    expect(surnameOnlyMatch(2)).toBe('ambiguous');
    expect(surnameOnlyMatch(5)).toBe('ambiguous');
  });

  it('is absent when no faculty carries the surname', () => {
    expect(surnameOnlyMatch(0)).toBe('absent');
  });
});
