import { describe, expect, it } from 'vitest';
import {
  assertRepairYsmAtozIndexSourceUrlApplyAllowed,
  parseRepairYsmAtozIndexSourceUrlArgs,
} from '../repairYsmAtozIndexSourceUrl';

describe('parseRepairYsmAtozIndexSourceUrlArgs', () => {
  it('defaults to a dry run', () => {
    const options = parseRepairYsmAtozIndexSourceUrlArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirm).toBe(false);
    expect(options.explicitLimit).toBe(false);
  });

  it('parses apply, confirm, and limit flags', () => {
    const options = parseRepairYsmAtozIndexSourceUrlArgs([
      '--apply',
      '--confirm-ysm-atoz-repair',
      '--limit=50',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirm).toBe(true);
    expect(options.limit).toBe(50);
    expect(options.explicitLimit).toBe(true);
  });

  it('rejects a non-positive-integer limit', () => {
    expect(() => parseRepairYsmAtozIndexSourceUrlArgs(['--limit=0'])).toThrow(
      '--limit must be a positive integer',
    );
  });
});

describe('assertRepairYsmAtozIndexSourceUrlApplyAllowed', () => {
  it('allows dry runs without confirmation or a limit', () => {
    expect(() =>
      assertRepairYsmAtozIndexSourceUrlApplyAllowed({
        apply: false,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('requires confirmation before apply', () => {
    expect(() =>
      assertRepairYsmAtozIndexSourceUrlApplyAllowed({
        apply: true,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow('--confirm-ysm-atoz-repair');
  });

  it('requires an explicit limit before apply', () => {
    expect(() =>
      assertRepairYsmAtozIndexSourceUrlApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow('--limit');
  });

  it('allows apply once confirmed and bounded', () => {
    expect(() =>
      assertRepairYsmAtozIndexSourceUrlApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: true,
      }),
    ).not.toThrow();
  });
});
