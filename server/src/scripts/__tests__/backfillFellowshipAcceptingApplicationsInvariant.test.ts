import { describe, expect, it } from 'vitest';

import { parseArgs } from '../backfillFellowshipAcceptingApplicationsInvariant';

describe('backfillFellowshipAcceptingApplicationsInvariant parseArgs', () => {
  it('defaults to a dry run', () => {
    const options = parseArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirm).toBe(false);
    expect(options.output).toBeUndefined();
  });

  it('requires the confirm flag to apply', () => {
    expect(() => parseArgs(['--apply'])).toThrow(
      /confirm-accepting-applications-invariant-backfill/,
    );
  });

  it('accepts apply with confirmation', () => {
    const options = parseArgs([
      '--apply',
      '--confirm-accepting-applications-invariant-backfill',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirm).toBe(true);
  });

  it('rejects an unknown argument', () => {
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument: --nope');
  });
});
