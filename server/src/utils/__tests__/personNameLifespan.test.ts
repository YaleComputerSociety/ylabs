import { describe, expect, it } from 'vitest';

import {
  personNameHasLifespanSuffix,
  stripPersonNameLifespanSuffix,
} from '../personNameLifespan';

describe('stripPersonNameLifespanSuffix', () => {
  it('strips a trailing birth-death lifespan glued onto a display name (#982)', () => {
    expect(stripPersonNameLifespanSuffix('Pierre Demarque 1932-2025')).toBe('Pierre Demarque');
  });

  it('strips a lifespan glued onto a surname field', () => {
    expect(stripPersonNameLifespanSuffix('Demarque 1932-2025')).toBe('Demarque');
  });

  it('handles spaced and en/em-dash separators', () => {
    expect(stripPersonNameLifespanSuffix('Pierre Demarque 1932 - 2025')).toBe('Pierre Demarque');
    expect(stripPersonNameLifespanSuffix('Pierre Demarque 1932–2025')).toBe('Pierre Demarque');
    expect(stripPersonNameLifespanSuffix('Pierre Demarque 1932—2025')).toBe('Pierre Demarque');
  });

  it('strips a parenthesized lifespan', () => {
    expect(stripPersonNameLifespanSuffix('Pierre Demarque (1932-2025)')).toBe('Pierre Demarque');
  });

  it('leaves a name without a lifespan untouched', () => {
    expect(stripPersonNameLifespanSuffix('Pierre Demarque')).toBe('Pierre Demarque');
  });

  it('does not strip a mid-name year range that is not a trailing token', () => {
    expect(stripPersonNameLifespanSuffix('Grant 1990-2000 Fellow')).toBe('Grant 1990-2000 Fellow');
  });

  it('does not touch a lone year or a phone-like trailing number', () => {
    expect(stripPersonNameLifespanSuffix('Jane Doe 2025')).toBe('Jane Doe 2025');
    expect(stripPersonNameLifespanSuffix('Jane Doe 203-432')).toBe('Jane Doe 203-432');
  });

  it('never returns an empty name when the input is only a lifespan', () => {
    expect(stripPersonNameLifespanSuffix('1932-2025')).toBe('1932-2025');
  });

  it('tolerates nullish input', () => {
    expect(stripPersonNameLifespanSuffix(undefined)).toBe('');
    expect(stripPersonNameLifespanSuffix(null)).toBe('');
  });
});

describe('personNameHasLifespanSuffix', () => {
  it('detects a birth-death lifespan in a name', () => {
    expect(personNameHasLifespanSuffix('Pierre Demarque 1932-2025')).toBe(true);
    expect(personNameHasLifespanSuffix('Demarque (1932-2025)')).toBe(true);
  });

  it('returns false for an ordinary name', () => {
    expect(personNameHasLifespanSuffix('Pierre Demarque')).toBe(false);
    expect(personNameHasLifespanSuffix('Jane Doe 2025')).toBe(false);
    expect(personNameHasLifespanSuffix(undefined)).toBe(false);
  });
});
