import { describe, expect, it } from 'vitest';

import {
  sustainedHostRefusals,
  type HostReadOutcome,
  type RunHostReadOutcomes,
} from '../sustainedHostRefusal';

const HOST = 'dept.example.edu';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-12-01T04:00:00Z');

const outcome = (counts: Partial<HostReadOutcome>): HostReadOutcome => ({
  answered: 0,
  refused: 0,
  skipped: 0,
  failed: 0,
  ...counts,
});

const run = (daysAgo: number, counts?: Partial<HostReadOutcome>): RunHostReadOutcomes => ({
  startedAt: new Date(NOW.getTime() - daysAgo * DAY),
  hostReadOutcomes: counts ? { [HOST]: outcome(counts) } : {},
});

describe('sustainedHostRefusals (#6195)', () => {
  it('flags a host refused on three runs spanning fourteen days with no answer between', () => {
    expect(
      sustainedHostRefusals([
        run(0, { refused: 2 }),
        run(7, { refused: 1 }),
        run(14, { refused: 4 }),
      ]),
    ).toEqual([
      {
        host: HOST,
        firstRefusedAt: new Date(NOW.getTime() - 14 * DAY),
        confirmingRefusalAt: NOW,
        runs: 3,
      },
    ]);
  });

  it('does not flag three refusals inside two days', () => {
    expect(
      sustainedHostRefusals([
        run(0, { refused: 1 }),
        run(1, { refused: 1 }),
        run(2, { refused: 1 }),
      ]),
    ).toEqual([]);
  });

  it('does not flag two refusals however far apart', () => {
    expect(sustainedHostRefusals([run(0, { refused: 1 }), run(30, { refused: 1 })])).toEqual([]);
  });

  it('ends the episode at any answer, a 404 included', () => {
    expect(
      sustainedHostRefusals([
        run(0, { refused: 1 }),
        run(7, { refused: 1, answered: 1 }),
        run(14, { refused: 1 }),
        run(21, { refused: 1 }),
      ]),
    ).toEqual([]);
  });

  it('never flags a host whose newest attempt was answered', () => {
    expect(
      sustainedHostRefusals([
        run(0, { answered: 3 }),
        run(7, { refused: 1 }),
        run(14, { refused: 1 }),
        run(21, { refused: 1 }),
      ]),
    ).toEqual([]);
  });

  it('lets a skipped, failed or untouched run neither extend nor break the episode', () => {
    const flagged = sustainedHostRefusals([
      run(0, { refused: 1 }),
      run(3, { skipped: 5 }),
      run(5, { failed: 2 }),
      run(6),
      run(9, { refused: 1 }),
      run(15, { refused: 1 }),
    ]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].runs).toBe(3);
  });

  it('does not count paused days, so a site-stated wait alone never flags a host', () => {
    expect(
      sustainedHostRefusals([
        run(0, { skipped: 4 }),
        run(7, { skipped: 4 }),
        run(20, { refused: 1 }),
      ]),
    ).toEqual([]);
  });
});
