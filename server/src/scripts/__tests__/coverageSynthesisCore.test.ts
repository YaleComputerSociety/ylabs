import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COVERAGE_SYNTHESIS_LIMIT,
  assertCoverageSynthesisApplyAllowed,
  parseCoverageSynthesisArgs,
} from '../coverageSynthesisCore';

describe('parseCoverageSynthesisArgs', () => {
  it('defaults to dry-run with a bounded limit', () => {
    const args = parseCoverageSynthesisArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.limit).toBe(DEFAULT_COVERAGE_SYNTHESIS_LIMIT);
  });

  it('parses apply, confirm, limit, and slugs', () => {
    const args = parseCoverageSynthesisArgs(['--apply', '--confirm-coverage-synthesis', '--limit=5', '--slugs=a,b']);
    expect(args.apply).toBe(true);
    expect(args.confirm).toBe(true);
    expect(args.limit).toBe(5);
    expect(args.slugs).toEqual(['a', 'b']);
  });

  it('falls back to the default limit for non-positive values', () => {
    expect(parseCoverageSynthesisArgs(['--limit=0']).limit).toBe(DEFAULT_COVERAGE_SYNTHESIS_LIMIT);
  });
});

describe('assertCoverageSynthesisApplyAllowed', () => {
  const dev = 'cluster/development';

  it('allows dry-run anywhere', () => {
    expect(() => assertCoverageSynthesisApplyAllowed(parseCoverageSynthesisArgs([]), 'cluster/prod')).not.toThrow();
  });

  it('requires the confirm flag to apply', () => {
    expect(() =>
      assertCoverageSynthesisApplyAllowed(parseCoverageSynthesisArgs(['--apply']), dev),
    ).toThrow(/--confirm-coverage-synthesis/);
  });

  it('restricts apply to a development database', () => {
    expect(() =>
      assertCoverageSynthesisApplyAllowed(
        parseCoverageSynthesisArgs(['--apply', '--confirm-coverage-synthesis']),
        'cluster/beta',
      ),
    ).toThrow(/Development database/);
  });

  it('allows a confirmed apply against development', () => {
    expect(() =>
      assertCoverageSynthesisApplyAllowed(
        parseCoverageSynthesisArgs(['--apply', '--confirm-coverage-synthesis']),
        dev,
      ),
    ).not.toThrow();
  });
});
