import { describe, expect, it } from 'vitest';
import {
  assertBackfillFallbackWaysInApplyAllowed,
  parseBackfillFallbackWaysInArgs,
} from '../backfillFallbackWaysInAccessSignals';

describe('backfillFallbackWaysInAccessSignals CLI helpers', () => {
  it('defaults to a dry-run', () => {
    const options = parseBackfillFallbackWaysInArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirmBackfillFallbackWaysIn).toBe(false);
    expect(options.limitProvided).toBe(false);
    expect(options.maxApply).toBe(200);
    expect(options.lastHex).toBeUndefined();
  });

  it('parses apply, limit, max-apply, and last-hex slice flags', () => {
    const options = parseBackfillFallbackWaysInArgs([
      '--apply',
      '--confirm-backfill-fallback-ways-in',
      '--limit=500',
      '--max-apply',
      '250',
      '--last-hex=89abcdef',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirmBackfillFallbackWaysIn).toBe(true);
    expect(options.limit).toBe(500);
    expect(options.limitProvided).toBe(true);
    expect(options.maxApply).toBe(250);
    expect(Array.from(options.lastHex ?? []).sort()).toEqual([
      '8',
      '9',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('normalizes last-hex separators and casing', () => {
    const options = parseBackfillFallbackWaysInArgs(['--last-hex=8, 9,A,B']);
    expect(Array.from(options.lastHex ?? []).sort()).toEqual(['8', '9', 'a', 'b']);
  });

  it('rejects a non-hex last-hex value', () => {
    expect(() => parseBackfillFallbackWaysInArgs(['--last-hex=8g'])).toThrow(/non-hex character/);
  });

  it('rejects an unknown argument', () => {
    expect(() => parseBackfillFallbackWaysInArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('allows dry-run without confirmation flags', () => {
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: false,
        plannedEntities: 10,
        maxApply: 5,
      }),
    ).not.toThrow();
  });

  it('requires --limit and --confirm when applying', () => {
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: true,
        limitProvided: false,
        confirmBackfillFallbackWaysIn: true,
        plannedEntities: 1,
        maxApply: 200,
      }),
    ).toThrow(/--limit is required/);
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: true,
        limitProvided: true,
        confirmBackfillFallbackWaysIn: false,
        plannedEntities: 1,
        maxApply: 200,
      }),
    ).toThrow(/--confirm-backfill-fallback-ways-in is required/);
  });

  it('refuses to apply above --max-apply', () => {
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: true,
        limitProvided: true,
        confirmBackfillFallbackWaysIn: true,
        plannedEntities: 201,
        maxApply: 200,
      }),
    ).toThrow(/above --max-apply/);
  });
});
