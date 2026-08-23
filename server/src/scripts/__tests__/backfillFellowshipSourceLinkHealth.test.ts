import { describe, expect, it } from 'vitest';

import {
  assertFellowshipSourceLinkHealthApplyAllowed,
  normalizeFellowshipSourceUrl,
  parseFellowshipSourceLinkHealthBackfillArgs,
} from '../backfillFellowshipSourceLinkHealth';

describe('parseFellowshipSourceLinkHealthBackfillArgs', () => {
  it('defaults to a dry run with no limit', () => {
    const options = parseFellowshipSourceLinkHealthBackfillArgs([]);
    expect(options.dryRun).toBe(true);
    expect(options.explicitLimit).toBe(false);
    expect(options.confirm).toBe(false);
  });

  it('parses apply mode, explicit limit, and the confirm flag', () => {
    const options = parseFellowshipSourceLinkHealthBackfillArgs([
      '--apply',
      '--limit=50',
      '--confirm-source-link-health',
    ]);
    expect(options.dryRun).toBe(false);
    expect(options.limit).toBe(50);
    expect(options.explicitLimit).toBe(true);
    expect(options.confirm).toBe(true);
  });

  it('rejects a non-positive limit', () => {
    expect(() => parseFellowshipSourceLinkHealthBackfillArgs(['--limit=0'])).toThrow();
    expect(() => parseFellowshipSourceLinkHealthBackfillArgs(['--limit=-3'])).toThrow();
  });

  it('rejects an unknown argument', () => {
    expect(() => parseFellowshipSourceLinkHealthBackfillArgs(['--nope'])).toThrow();
  });
});

describe('assertFellowshipSourceLinkHealthApplyAllowed', () => {
  it('allows a dry run without confirmation or limit', () => {
    expect(() =>
      assertFellowshipSourceLinkHealthApplyAllowed({
        dryRun: true,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('requires confirmation to apply', () => {
    expect(() =>
      assertFellowshipSourceLinkHealthApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/confirm-source-link-health/);
  });

  it('requires an explicit limit to apply', () => {
    expect(() =>
      assertFellowshipSourceLinkHealthApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });

  it('allows a fully specified apply', () => {
    expect(() =>
      assertFellowshipSourceLinkHealthApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: true,
      }),
    ).not.toThrow();
  });
});

describe('normalizeFellowshipSourceUrl', () => {
  it('keeps a trimmed http(s) url', () => {
    expect(normalizeFellowshipSourceUrl('  https://wff.yale.edu/grants  ')).toBe(
      'https://wff.yale.edu/grants',
    );
  });

  it('rejects empty, non-string, and non-http values', () => {
    expect(normalizeFellowshipSourceUrl('')).toBeNull();
    expect(normalizeFellowshipSourceUrl('   ')).toBeNull();
    expect(normalizeFellowshipSourceUrl(null)).toBeNull();
    expect(normalizeFellowshipSourceUrl(42)).toBeNull();
    expect(normalizeFellowshipSourceUrl('mailto:x@example.edu')).toBeNull();
    expect(normalizeFellowshipSourceUrl('not a url')).toBeNull();
  });
});
