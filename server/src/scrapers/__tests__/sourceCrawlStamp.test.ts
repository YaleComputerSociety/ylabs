import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sourceUpdateOne: vi.fn() }));

vi.mock('../../models/source', () => ({ Source: { updateOne: mocks.sourceUpdateOne } }));

import { runEarnsCrawlStamp, stampSourceCrawlIfEarned } from '../sourceCrawlStamp';

const AT = new Date('2026-10-02T12:00:00Z');

describe('the source crawl stamp (#3721)', () => {
  beforeEach(() => {
    mocks.sourceUpdateOne.mockReset();
    mocks.sourceUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('leaves lastCrawledAt unchanged for a run that ended failure', async () => {
    const stamped = await stampSourceCrawlIfEarned(
      'fixture-source',
      { dryRun: false, runStatus: 'failure' },
      AT,
    );

    expect(stamped).toBe(false);
    expect(mocks.sourceUpdateOne).not.toHaveBeenCalled();
  });

  it('stamps a successful or partial run at the time it is given', async () => {
    for (const runStatus of ['success', 'partial'] as const) {
      mocks.sourceUpdateOne.mockClear();
      const stamped = await stampSourceCrawlIfEarned(
        'fixture-source',
        { dryRun: false, runStatus, materializationErrors: 0 },
        AT,
      );

      expect(stamped).toBe(true);
      expect(mocks.sourceUpdateOne).toHaveBeenCalledWith(
        { name: 'fixture-source' },
        { $set: { lastCrawledAt: AT } },
      );
    }
  });

  it('never stamps an interrupted run, a dry run, or a run whose materialization failed', () => {
    expect(runEarnsCrawlStamp({ dryRun: false, runStatus: 'interrupted' })).toBe(false);
    expect(runEarnsCrawlStamp({ dryRun: true, runStatus: 'success' })).toBe(false);
    expect(
      runEarnsCrawlStamp({ dryRun: false, runStatus: 'success', materializationErrors: 2 }),
    ).toBe(false);
    expect(runEarnsCrawlStamp({ dryRun: false, runStatus: 'success' })).toBe(true);
  });
});
