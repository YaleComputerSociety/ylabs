import { describe, expect, it } from 'vitest';
import { isFoldableNameVariant } from '../canonicalMembershipMaterializer';

describe('isFoldableNameVariant (#5923)', () => {
  it('reads a middle initial or middle name added or dropped as one person', () => {
    expect(isFoldableNameVariant('Avery Synthetic', 'Avery Q. Synthetic')).toBe(true);
    expect(isFoldableNameVariant('Avery Quinn Synthetic', 'Avery Q Synthetic')).toBe(true);
  });

  it('gives the same answer whichever side carries the extra middle name', () => {
    expect(isFoldableNameVariant('Avery Q Synthetic', 'Avery Q R Synthetic')).toBe(true);
    expect(isFoldableNameVariant('Avery Q R Synthetic', 'Avery Q Synthetic')).toBe(true);
  });

  it('reads an equivalent given name with a middle initial dropped as one person', () => {
    expect(isFoldableNameVariant('Kate Synthetic', 'Katherine Q Synthetic')).toBe(true);
    expect(isFoldableNameVariant('Katherine Q Synthetic', 'Kate Synthetic')).toBe(true);
  });

  it('never reads two different full middle names as one person', () => {
    expect(isFoldableNameVariant('Avery Quinn Synthetic', 'Avery Quentin Synthetic')).toBe(false);
  });

  it('reads a hyphenated and an unhyphenated spelling as one person', () => {
    expect(isFoldableNameVariant('Avery Synthetic-Fixture', 'Avery Synthetic Fixture')).toBe(true);
  });

  it('reads an equivalent given name as one person', () => {
    expect(isFoldableNameVariant('Kate Synthetic', 'Katherine Synthetic')).toBe(true);
  });

  it('never reads two different given names under one surname as one person', () => {
    expect(isFoldableNameVariant('Avery Synthetic', 'Blair Synthetic')).toBe(false);
    expect(isFoldableNameVariant('Avery Q Synthetic', 'Avery R Synthetic')).toBe(false);
    expect(isFoldableNameVariant('Avery Synthetic', 'Avery Fixture')).toBe(false);
  });

  it('leaves an exact match to the exact comparison', () => {
    expect(isFoldableNameVariant('Avery Synthetic', 'avery synthetic')).toBe(false);
  });
});
