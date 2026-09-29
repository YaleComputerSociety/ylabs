import { describe, expect, it } from 'vitest';
import {
  aggregateBbsTrackReads,
  bbsTrackReadBlocksRetirementOf,
  planBbsTrackRosterRetirement,
  type BbsTrackRosterRead,
} from '../bbsTrackRosterRetirement';

const read = (options: {
  runId: string;
  at: string;
  listed: string[];
  unresolved?: string[];
  discoveredCount?: number;
}): BbsTrackRosterRead =>
  ({
    scrapeRunId: options.runId,
    observedAt: new Date(options.at),
    discoveredCount:
      options.discoveredCount ?? options.listed.length + (options.unresolved?.length ?? 0),
    claimEntityKeys: new Set(options.listed),
    unresolvedMemberKeys: new Set(options.unresolved ?? []),
    memberKeys: new Set<string>(),
    memberClaims: new Set<string>(),
    memberProfileClaims: new Set<string>(),
    membershipKeys: new Set<string>(),
    relationshipKeys: new Set<string>(),
    members: [],
  }) as unknown as BbsTrackRosterRead;

const claim = (entityKey: string, at = '2026-09-01T00:00:00Z') => ({
  observationId: `obs-${entityKey}`,
  entityKey,
  observedAt: new Date(at),
});

describe('bbsTrackReadBlocksRetirementOf', () => {
  it('blocks a row whose PI is listed but resolved to nothing this run', () => {
    const history = new Map([['pi-one', new Set(['row-one'])]]);
    expect(
      bbsTrackReadBlocksRetirementOf(
        'row-one',
        read({ runId: 'r1', at: '2026-09-10T00:00:00Z', listed: [], unresolved: ['pi-one'] }),
        history,
      ),
    ).toBe(true);
  });

  it('does not block a row no unresolved PI has ever claimed', () => {
    const history = new Map([['pi-one', new Set(['row-one'])]]);
    expect(
      bbsTrackReadBlocksRetirementOf(
        'row-two',
        read({ runId: 'r1', at: '2026-09-10T00:00:00Z', listed: [], unresolved: ['pi-one'] }),
        history,
      ),
    ).toBe(false);
  });
});

describe('planBbsTrackRosterRetirement', () => {
  const history = new Map([['pi-one', new Set(['row-one'])]]);

  // The pair the manager asked for. The converse matters as much: without it, "listed but
  // unresolved does not retire" is satisfied by a mechanism that retires nothing at all.
  it('retires a claim two admitted reads omitted', () => {
    const plan = planBbsTrackRosterRetirement({
      reads: [
        read({ runId: 'r1', at: '2026-09-10T00:00:00Z', listed: ['row-two', 'row-three'] }),
        read({ runId: 'r2', at: '2026-09-11T00:00:00Z', listed: ['row-two', 'row-three'] }),
      ],
      claims: [claim('row-one'), claim('row-two'), claim('row-three')],
      claimRowsEverHeldByPi: history,
    });
    expect(plan.verdict).toBe('retired');
    expect(plan.retiredObservationIds).toEqual(['obs-row-one']);
    expect(plan.counts.retiredClaims).toBe(1);
  });

  it('retires nothing when the PI is listed but unresolved, however many reads omit the row', () => {
    const plan = planBbsTrackRosterRetirement({
      reads: [
        read({
          runId: 'r1',
          at: '2026-09-10T00:00:00Z',
          listed: ['row-two'],
          unresolved: ['pi-one'],
        }),
        read({
          runId: 'r2',
          at: '2026-09-11T00:00:00Z',
          listed: ['row-two'],
          unresolved: ['pi-one'],
        }),
      ],
      claims: [claim('row-one'), claim('row-two')],
      claimRowsEverHeldByPi: history,
    });
    expect(plan.verdict).toBe('nothing-to-retire');
    expect(plan.retiredObservationIds).toEqual([]);
    expect(plan.counts.claimsBlockedByAnUnresolvedPi).toBe(1);
  });

  it('waits for a second read rather than retiring on one', () => {
    const plan = planBbsTrackRosterRetirement({
      reads: [read({ runId: 'r1', at: '2026-09-10T00:00:00Z', listed: ['row-two'] })],
      claims: [claim('row-one'), claim('row-two')],
      claimRowsEverHeldByPi: history,
    });
    expect(plan.verdict).toBe('nothing-to-retire');
    expect(plan.counts.claimsAwaitingSecondRead).toBe(1);
  });

  // A broken selector stops listing everybody at once and persists across runs, which is what
  // defeats a two-read guard on its own.
  it('freezes rather than retiring when more than half the claims look absent', () => {
    const plan = planBbsTrackRosterRetirement({
      reads: [
        read({ runId: 'r1', at: '2026-09-10T00:00:00Z', listed: ['row-four'] }),
        read({ runId: 'r2', at: '2026-09-11T00:00:00Z', listed: ['row-four'] }),
      ],
      claims: [claim('row-one'), claim('row-two'), claim('row-three'), claim('row-four')],
      claimRowsEverHeldByPi: new Map(),
    });
    expect(plan.verdict).toBe('frozen');
    expect(plan.freezeReason).toBe('member-absence-above-ceiling');
    expect(plan.retiredObservationIds).toEqual([]);
  });

  it('freezes when the latest read lists far fewer rows than the largest on record', () => {
    const plan = planBbsTrackRosterRetirement({
      reads: [
        read({
          runId: 'r1',
          at: '2026-09-10T00:00:00Z',
          listed: ['row-two'],
          discoveredCount: 100,
        }),
        read({ runId: 'r2', at: '2026-09-11T00:00:00Z', listed: ['row-two'], discoveredCount: 10 }),
      ],
      claims: [claim('row-one'), claim('row-two')],
      claimRowsEverHeldByPi: new Map(),
    });
    expect(plan.verdict).toBe('frozen');
    expect(plan.freezeReason).toBe('discovery-regressed');
  });

  it('retires nothing when no read has been admitted', () => {
    const plan = planBbsTrackRosterRetirement({
      reads: [],
      claims: [claim('row-one')],
      claimRowsEverHeldByPi: new Map(),
    });
    expect(plan.verdict).toBe('nothing-to-retire');
    expect(plan.counts.admittedReads).toBe(0);
  });
});

describe('aggregateBbsTrackReads', () => {
  const snapshot = (options: {
    members: Array<{ memberKey: string; claimEntityKey?: string }>;
    cacheAllowed?: boolean;
    pagesRead?: number;
    complete?: boolean;
  }) => ({
    status: options.members.length > 0 ? 'ok' : 'empty',
    complete: options.complete ?? true,
    members: options.members.map((m) => ({ role: 'track-pi', ...m })),
    read: {
      pagesRead: options.pagesRead ?? 1,
      readMode: 'html',
      cacheAllowed: options.cacheAllowed ?? false,
      stopReason: 'not-paginated',
    },
  });

  // One read per run, unioned across tracks: a PI listed by two tracks holds one observation whose
  // value spans both, so absence has to mean no track lists the row.
  it("unions a run's track snapshots into one read", () => {
    const { reads } = aggregateBbsTrackReads([
      {
        scrapeRunId: 'r1',
        observedAt: '2026-09-10T00:00:00Z',
        value: snapshot({ members: [{ memberKey: 'pi-a', claimEntityKey: 'row-a' }] }),
      },
      {
        scrapeRunId: 'r1',
        observedAt: '2026-09-10T00:05:00Z',
        value: snapshot({ members: [{ memberKey: 'pi-b', claimEntityKey: 'row-b' }] }),
      },
    ]);
    expect(reads).toHaveLength(1);
    expect([...reads[0].claimEntityKeys].sort()).toEqual(['row-a', 'row-b']);
  });

  it('excludes a snapshot the admissibility contract refuses', () => {
    const { reads } = aggregateBbsTrackReads([
      { scrapeRunId: 'r1', observedAt: '2026-09-10T00:00:00Z', value: snapshot({ members: [] }) },
      {
        scrapeRunId: 'r2',
        observedAt: '2026-09-11T00:00:00Z',
        value: snapshot({
          members: [{ memberKey: 'pi-a', claimEntityKey: 'row-a' }],
          cacheAllowed: true,
        }),
      },
      {
        scrapeRunId: 'r3',
        observedAt: '2026-09-12T00:00:00Z',
        value: snapshot({
          members: [{ memberKey: 'pi-a', claimEntityKey: 'row-a' }],
          pagesRead: 0,
        }),
      },
    ]);
    expect(reads).toEqual([]);
  });

  it('records a listed PI that resolved to no row as unresolved, once it has ever held a row', () => {
    const { reads, rowsEverHeldByPi } = aggregateBbsTrackReads([
      {
        scrapeRunId: 'r1',
        observedAt: '2026-09-10T00:00:00Z',
        value: snapshot({ members: [{ memberKey: 'pi-a', claimEntityKey: 'row-a' }] }),
      },
      {
        scrapeRunId: 'r2',
        observedAt: '2026-09-11T00:00:00Z',
        value: snapshot({
          members: [
            { memberKey: 'pi-a' },
            { memberKey: 'pi-z' },
            { memberKey: 'pi-b', claimEntityKey: 'row-b' },
          ],
        }),
      },
    ]);
    expect(rowsEverHeldByPi.get('pi-a')).toEqual(new Set(['row-a']));
    const second = reads.find((r) => r.scrapeRunId === 'r2');
    // pi-a blocks because it has held a row; pi-z never has, so it is pruned and blocks nothing.
    expect([...(second?.unresolvedMemberKeys ?? [])]).toEqual(['pi-a']);
  });

  it('orders reads oldest first, so the two-read rule reads a sequence', () => {
    const { reads } = aggregateBbsTrackReads([
      {
        scrapeRunId: 'r2',
        observedAt: '2026-09-11T00:00:00Z',
        value: snapshot({ members: [{ memberKey: 'pi-a', claimEntityKey: 'row-a' }] }),
      },
      {
        scrapeRunId: 'r1',
        observedAt: '2026-09-10T00:00:00Z',
        value: snapshot({ members: [{ memberKey: 'pi-a', claimEntityKey: 'row-a' }] }),
      },
    ]);
    expect(reads.map((r) => r.scrapeRunId)).toEqual(['r1', 'r2']);
  });
});
