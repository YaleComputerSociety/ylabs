import { describe, expect, it } from 'vitest';
import {
  planRosterMintWithdrawalForDept,
  slugsListedByAnotherRoster,
  type RosterMintWithdrawalRead,
} from '../rosterMintWithdrawal';

const read = (
  deptKey: string,
  runId: string,
  observedAt: string,
  discovered: string[],
  withdrawn: string[] = [],
): RosterMintWithdrawalRead => ({
  runId,
  deptKey,
  observedAt: new Date(observedAt),
  discovered: new Set(discovered),
  withdrawn: new Set(withdrawn),
  profilesRead: 10,
});

describe('one roster dropping a shared row does not retire it (#5969)', () => {
  const shared = 'dept-synthetic-alpha-ada-alpha';
  const filler = Array.from({ length: 9 }, (_, index) => `dept-synthetic-alpha-filler-${index}`);

  it('the withdrawing roster alone would retire the row', () => {
    const plan = planRosterMintWithdrawalForDept({
      deptKey: 'synthetic-alpha',
      currentRunId: 'run-2',
      reads: [
        read('synthetic-alpha', 'run-1', '2026-11-01T00:00:00Z', filler, [shared]),
        read('synthetic-alpha', 'run-2', '2026-11-08T00:00:00Z', filler, [shared]),
      ],
      liveLaneRowSlugs: new Set([shared, ...filler]),
    });
    expect(plan.withdrawnSlugs).toEqual([shared]);
  });

  it('keeps a withdrawn slug another roster still lists in its newest read', () => {
    const withdrawn = new Map([[shared, 'synthetic-alpha']]);
    expect(
      slugsListedByAnotherRoster(withdrawn, [
        read('synthetic-beta', 'run-1', '2026-11-01T00:00:00Z', []),
        read('synthetic-beta', 'run-2', '2026-11-08T00:00:00Z', [shared]),
      ]),
    ).toEqual(new Set([shared]));
  });

  it('does not keep it on the withdrawing roster’s own listing or on another roster’s stale one', () => {
    const withdrawn = new Map([[shared, 'synthetic-alpha']]);
    expect(
      slugsListedByAnotherRoster(withdrawn, [
        read('synthetic-alpha', 'run-2', '2026-11-08T00:00:00Z', [shared]),
        read('synthetic-beta', 'run-1', '2026-11-01T00:00:00Z', [shared]),
        read('synthetic-beta', 'run-2', '2026-11-08T00:00:00Z', []),
      ]),
    ).toEqual(new Set());
  });
});
