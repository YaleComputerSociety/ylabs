import { describe, expect, it } from 'vitest';
import { parseRebuildAdminAccessReviewProjectionArgs } from '../rebuildAdminAccessReviewProjection';

describe('rebuildAdminAccessReviewProjection CLI', () => {
  it('defaults to a dry-run for an explicit non-production target', () => {
    expect(parseRebuildAdminAccessReviewProjectionArgs(['--environment=development'])).toEqual({
      environment: 'development',
      apply: false,
      batchSize: 100,
    });
  });

  it('requires a reviewed artifact and exact environment confirmation for apply', () => {
    expect(() =>
      parseRebuildAdminAccessReviewProjectionArgs([
        '--environment=beta',
        '--apply',
        '--confirm-admin-access-review-projection=beta',
      ]),
    ).toThrow(/--apply-from/);

    expect(
      parseRebuildAdminAccessReviewProjectionArgs([
        '--environment=beta',
        '--apply',
        '--apply-from=/tmp/access-review-plan.json',
        '--confirm-admin-access-review-projection=beta',
        '--batch-size=250',
      ]),
    ).toMatchObject({
      environment: 'beta',
      apply: true,
      applyFrom: '/tmp/access-review-plan.json',
      confirmEnvironment: 'beta',
      batchSize: 250,
    });
  });

  it('rejects direct production projection writes', () => {
    expect(() => parseRebuildAdminAccessReviewProjectionArgs(['--environment=production'])).toThrow(
      /Production is not a permitted/,
    );
  });
});
