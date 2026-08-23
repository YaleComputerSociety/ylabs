import { describe, it, expect } from 'vitest';
import { normalizeInitialSpacing } from '../scraperHelpers';

describe('normalizeInitialSpacing', () => {
  it('keeps a single-letter initial followed by a period spaced from the surname', () => {
    expect(normalizeInitialSpacing('X. Liu Lab')).toBe('X. Liu Lab');
  });

  it('restores the space after an initial period that was glued to the surname', () => {
    expect(normalizeInitialSpacing('X.Liu Lab')).toBe('X. Liu Lab');
  });

  it('spaces every initial in a chain of initials', () => {
    expect(normalizeInitialSpacing('J. R. R. Example Lab')).toBe('J. R. R. Example Lab');
    expect(normalizeInitialSpacing('J.R.R. Example Lab')).toBe('J. R. R. Example Lab');
  });

  it('collapses ordinary whitespace without inventing initials', () => {
    expect(normalizeInitialSpacing('Zhang   Laboratory  of Biophysics')).toBe(
      'Zhang Laboratory of Biophysics',
    );
    expect(normalizeInitialSpacing('  Arnsten Lab  ')).toBe('Arnsten Lab');
  });

  it('leaves period-less names untouched', () => {
    expect(normalizeInitialSpacing('XLiu Lab')).toBe('XLiu Lab');
  });

  it('returns an empty string for falsy input', () => {
    expect(normalizeInitialSpacing('')).toBe('');
    expect(normalizeInitialSpacing(null)).toBe('');
    expect(normalizeInitialSpacing(undefined)).toBe('');
  });
});
