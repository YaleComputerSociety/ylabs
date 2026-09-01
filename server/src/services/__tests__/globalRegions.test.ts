import { describe, expect, it } from 'vitest';
import {
  TOP_LEVEL_GLOBAL_REGIONS,
  collapseDefaultFillGlobalRegions,
  distinctGlobalRegions,
  isFullRegionEnumeration,
} from '../globalRegions';

describe('globalRegions', () => {
  it('treats the full seven-region enumeration as default-fill (no real restriction)', () => {
    expect(isFullRegionEnumeration([...TOP_LEVEL_GLOBAL_REGIONS])).toBe(true);
    expect(collapseDefaultFillGlobalRegions([...TOP_LEVEL_GLOBAL_REGIONS])).toEqual([]);
  });

  it('detects the full enumeration regardless of order or duplicates', () => {
    const shuffledWithDupes = [
      'Oceania',
      'Africa',
      'Africa',
      'North America',
      'Asia',
      'Europe',
      'Middle East & Persian Gulf',
      'Latin America and Caribbean',
    ];
    expect(isFullRegionEnumeration(shuffledWithDupes)).toBe(true);
    expect(collapseDefaultFillGlobalRegions(shuffledWithDupes)).toEqual([]);
  });

  it('preserves legitimately multi-region records that are not the full enumeration', () => {
    const partial = ['Africa', 'Asia', 'Europe'];
    expect(isFullRegionEnumeration(partial)).toBe(false);
    expect(collapseDefaultFillGlobalRegions(partial)).toEqual(['Africa', 'Asia', 'Europe']);
  });

  it('preserves a single-region record', () => {
    expect(collapseDefaultFillGlobalRegions(['Africa'])).toEqual(['Africa']);
  });

  it('leaves an already-empty or undefined region set empty', () => {
    expect(collapseDefaultFillGlobalRegions([])).toEqual([]);
    expect(collapseDefaultFillGlobalRegions(undefined)).toEqual([]);
    expect(isFullRegionEnumeration(undefined)).toBe(false);
  });

  it('normalizes whitespace and drops blanks when computing distinct regions', () => {
    expect(distinctGlobalRegions([' Africa ', '', 'Africa', '  '])).toEqual(['Africa']);
  });
});
