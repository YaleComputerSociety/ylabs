import { describe, expect, it } from 'vitest';
import {
  classifySourceFreshness,
  computeSourceFreshness,
  getStaleSources,
  summarizeSourceFreshness,
  SourceFreshnessInput,
} from '../sourceFreshnessService';

const NOW = new Date('2026-05-14T12:00:00Z');

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('classifySourceFreshness', () => {
  it('ranks a row with no lastCrawledAt as never-crawled, not a crash', () => {
    const entry = classifySourceFreshness(
      { name: 'legacy-source', enabled: true, coverage: { priority: 80 } },
      NOW,
    );

    expect(entry).toMatchObject({ status: 'never-crawled', lastCrawledAt: null });
  });

  it('excludes disabled sources entirely', () => {
    expect(classifySourceFreshness({ name: 'off', enabled: false }, NOW)).toBeNull();
  });

  it('exempts MANUAL_OVERRIDE sources from a re-crawl expectation', () => {
    const entry = classifySourceFreshness(
      {
        name: 'manual-edit-channel',
        enabled: true,
        lastCrawledAt: daysAgo(9999),
        coverage: { tier: 'MANUAL_OVERRIDE' },
      },
      NOW,
    );

    expect(entry).toBeNull();
  });

  it('classifies fresh, due-soon, and overdue against the cadence', () => {
    const fresh = classifySourceFreshness(
      { name: 'fresh', enabled: true, lastCrawledAt: daysAgo(5), cadenceDays: 30 },
      NOW,
    );
    const dueSoon = classifySourceFreshness(
      { name: 'due-soon', enabled: true, lastCrawledAt: daysAgo(25), cadenceDays: 30 },
      NOW,
    );
    const overdue = classifySourceFreshness(
      { name: 'overdue', enabled: true, lastCrawledAt: daysAgo(45), cadenceDays: 30 },
      NOW,
    );

    expect(fresh?.status).toBe('fresh');
    expect(dueSoon?.status).toBe('due-soon');
    expect(overdue?.status).toBe('overdue');
  });

  it('falls back to a tier default cadence when cadenceDays is unset', () => {
    const entry = classifySourceFreshness(
      {
        name: 'primary-official',
        enabled: true,
        lastCrawledAt: daysAgo(20),
        coverage: { tier: 'PRIMARY_OFFICIAL' },
      },
      NOW,
    );

    // PRIMARY_OFFICIAL defaults to a 14-day cadence, so 20 days overdue.
    expect(entry).toMatchObject({ status: 'overdue', cadenceDays: 14 });
  });
});

describe('getStaleSources', () => {
  const sources: SourceFreshnessInput[] = [
    { name: 'fresh-a', enabled: true, lastCrawledAt: daysAgo(1), cadenceDays: 30 },
    {
      name: 'overdue-low-priority',
      enabled: true,
      lastCrawledAt: daysAgo(60),
      cadenceDays: 30,
      coverage: { priority: 10 },
    },
    {
      name: 'overdue-high-priority',
      enabled: true,
      lastCrawledAt: daysAgo(90),
      cadenceDays: 30,
      coverage: { priority: 90 },
    },
    { name: 'never-crawled-low-priority', enabled: true, coverage: { priority: 5 } },
    { name: 'never-crawled-high-priority', enabled: true, coverage: { priority: 95 } },
  ];

  it('ranks never-crawled sources above overdue sources regardless of priority', () => {
    const worklist = getStaleSources(sources, NOW);
    const statuses = worklist.map((entry) => entry.status);
    const firstOverdueIndex = statuses.indexOf('overdue');
    const lastNeverCrawledIndex = statuses.lastIndexOf('never-crawled');

    expect(firstOverdueIndex).toBeGreaterThan(-1);
    expect(lastNeverCrawledIndex).toBeGreaterThan(-1);
    expect(lastNeverCrawledIndex).toBeLessThan(firstOverdueIndex);
  });

  it('orders each status group by student-impact priority and overdue magnitude', () => {
    const worklist = getStaleSources(sources, NOW);
    const names = worklist.map((entry) => entry.name);

    expect(names).toEqual([
      'never-crawled-high-priority',
      'never-crawled-low-priority',
      'overdue-high-priority',
      'overdue-low-priority',
    ]);
  });

  it('excludes fresh and due-soon sources from the worklist', () => {
    const worklist = getStaleSources(sources, NOW);
    expect(worklist.some((entry) => entry.name === 'fresh-a')).toBe(false);
  });
});

describe('summarizeSourceFreshness', () => {
  it('tallies each status bucket plus exempt/disabled sources', () => {
    const summary = summarizeSourceFreshness(
      [
        { name: 'fresh', enabled: true, lastCrawledAt: daysAgo(1), cadenceDays: 30 },
        { name: 'due-soon', enabled: true, lastCrawledAt: daysAgo(25), cadenceDays: 30 },
        { name: 'overdue', enabled: true, lastCrawledAt: daysAgo(45), cadenceDays: 30 },
        { name: 'never-crawled', enabled: true },
        { name: 'disabled', enabled: false },
        { name: 'manual', enabled: true, coverage: { tier: 'MANUAL_OVERRIDE' } },
      ],
      NOW,
    );

    expect(summary).toEqual({ fresh: 1, dueSoon: 1, overdue: 1, neverCrawled: 1, exempt: 2 });
  });
});

describe('computeSourceFreshness', () => {
  it('drops disabled and exempt rows from the classified list', () => {
    const entries = computeSourceFreshness(
      [
        { name: 'kept', enabled: true, lastCrawledAt: daysAgo(1), cadenceDays: 30 },
        { name: 'disabled', enabled: false },
      ],
      NOW,
    );

    expect(entries.map((entry) => entry.name)).toEqual(['kept']);
  });
});
