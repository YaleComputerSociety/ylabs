import { describe, expect, it } from 'vitest';

import {
  ROSTER_PROFILE_PROGRESS_EVERY,
  ROSTER_PROFILE_PROGRESS_INTERVAL_MS,
  rosterProfileProgress,
} from '../sources/departmentRosterScraper';

const readRows = (count: number, progress: { beforeRow: () => void }) => {
  for (let row = 0; row < count; row += 1) progress.beforeRow();
};

describe('the roster profile progress line', () => {
  it('prints a counts-only line after every batch of rows read', () => {
    const lines: string[] = [];
    const total = ROSTER_PROFILE_PROGRESS_EVERY * 2 + 5;
    const progress = rosterProfileProgress(
      'fixture-dept',
      total,
      (line) => lines.push(line),
      () => 0,
    );
    readRows(total, progress);
    expect(lines).toEqual([
      `[fixture-dept] read ${ROSTER_PROFILE_PROGRESS_EVERY} of ${total} roster row(s) so far`,
      `[fixture-dept] read ${ROSTER_PROFILE_PROGRESS_EVERY * 2} of ${total} roster row(s) so far`,
    ]);
  });

  it('prints a line when a slow row passes the interval before the batch fills', () => {
    const lines: string[] = [];
    let clock = 0;
    const progress = rosterProfileProgress(
      'fixture-dept',
      10,
      (line) => lines.push(line),
      () => clock,
    );
    progress.beforeRow();
    clock = ROSTER_PROFILE_PROGRESS_INTERVAL_MS;
    progress.beforeRow();
    expect(lines).toEqual(['[fixture-dept] read 1 of 10 roster row(s) so far']);
  });
});
