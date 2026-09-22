import { describe, expect, it } from 'vitest';

import { CONFIRM_FLAG, parseRepairPersonNameNoiseArgs } from '../repairPersonNameNoise';

describe('parseRepairPersonNameNoiseArgs', () => {
  it('defaults to an unconfirmed dry run with no blast-radius cap', () => {
    expect(parseRepairPersonNameNoiseArgs([])).toEqual({
      dryRun: true,
      confirmed: false,
    });
  });

  it('parses apply, the confirmation flag, and an explicit limit', () => {
    expect(parseRepairPersonNameNoiseArgs(['--apply', CONFIRM_FLAG, '--limit=25'])).toMatchObject({
      dryRun: false,
      confirmed: true,
      limit: 25,
    });
    expect(parseRepairPersonNameNoiseArgs(['--limit', '7'])).toMatchObject({ limit: 7 });
  });

  it('refuses a limit that is not a positive integer', () => {
    expect(() => parseRepairPersonNameNoiseArgs(['--limit=0'])).toThrow(/positive integer/);
    expect(() => parseRepairPersonNameNoiseArgs(['--limit=-3'])).toThrow(/positive integer/);
    expect(() => parseRepairPersonNameNoiseArgs(['--limit'])).toThrow(/positive integer/);
  });

  it('rejects an unknown argument', () => {
    expect(() => parseRepairPersonNameNoiseArgs(['--nope'])).toThrow(/Unknown/);
  });
});
