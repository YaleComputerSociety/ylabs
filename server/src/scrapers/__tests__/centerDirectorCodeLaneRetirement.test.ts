import { describe, expect, it } from 'vitest';
import { planCodeLaneDirectorRetirement } from '../centerDirectorRetirement';
import {
  centerDirectorReadSnapshotObservation,
  codeLaneDirectorReadFromSnapshot,
  type CenterDirectorReadSnapshot,
  type CodeLaneDirectorRead,
} from '../centerDirectorReadSnapshot';

const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const QUILL = { name: 'Quill Fenwick', role: 'director' as const };
const ORLA = { name: 'Orla Brightwater', role: 'director' as const };

const read = (
  n: number,
  settled: CodeLaneDirectorRead['settled'],
  stated: CodeLaneDirectorRead['stated'] = settled ? [settled] : [],
): CodeLaneDirectorRead => ({ scrapeRunId: `run-${n}`, observedAt: day(n), settled, stated });

const edge = (id: string, director = QUILL, observedAt: Date | null = day(1)) => ({
  edgeId: id,
  director,
  observedAt,
});

describe('planCodeLaneDirectorRetirement', () => {
  it('ends an LLM edge for a different person once the code lane settles on someone', () => {
    const plan = planCodeLaneDirectorRetirement({
      reads: [read(2, ORLA)],
      ownEdges: [],
      llmEdges: [edge('llm-1')],
    });
    expect(plan.handedOffLlmEdgeIds).toEqual(['llm-1']);
  });

  it('ends an LLM edge the page states beside a settled faculty director', () => {
    const plan = planCodeLaneDirectorRetirement({
      reads: [read(2, ORLA, [ORLA, QUILL])],
      ownEdges: [],
      llmEdges: [edge('llm-1')],
    });
    expect(plan.handedOffLlmEdgeIds).toEqual(['llm-1']);
  });

  it('keeps an LLM edge for the person the code lane settled on', () => {
    const plan = planCodeLaneDirectorRetirement({
      reads: [read(2, QUILL)],
      ownEdges: [],
      llmEdges: [edge('llm-1')],
    });
    expect(plan).toMatchObject({ handedOffLlmEdgeIds: [], supportedLlmEdges: 1 });
  });

  it('keeps an LLM edge a refused read still states, and ends one a refused read omits', () => {
    const tie = read(2, null, [QUILL, ORLA]);
    expect(
      planCodeLaneDirectorRetirement({ reads: [tie], ownEdges: [], llmEdges: [edge('llm-1')] }),
    ).toMatchObject({ handedOffLlmEdgeIds: [], supportedLlmEdges: 1 });
    expect(
      planCodeLaneDirectorRetirement({
        reads: [read(2, null, [ORLA, { name: 'Pell Marrowby', role: 'director' }])],
        ownEdges: [],
        llmEdges: [edge('llm-1')],
      }).handedOffLlmEdgeIds,
    ).toEqual(['llm-1']);
  });

  it('ends an LLM edge on a read that states no director, and on no evidence of the role', () => {
    expect(
      planCodeLaneDirectorRetirement({
        reads: [read(2, null, [])],
        ownEdges: [],
        llmEdges: [edge('llm-1', QUILL, null)],
      }).handedOffLlmEdgeIds,
    ).toEqual(['llm-1']);
    expect(
      planCodeLaneDirectorRetirement({
        reads: [read(2, null, [{ name: 'Quill Fenwick', role: 'co-director' }])],
        ownEdges: [],
        llmEdges: [edge('llm-1')],
      }).handedOffLlmEdgeIds,
    ).toEqual(['llm-1']);
  });

  it('waits for a code-lane read made after the LLM edge was last observed', () => {
    const plan = planCodeLaneDirectorRetirement({
      reads: [read(2, ORLA)],
      ownEdges: [],
      llmEdges: [edge('llm-1', QUILL, day(3))],
    });
    expect(plan).toMatchObject({ handedOffLlmEdgeIds: [], llmEdgesAwaitingRead: 1 });
  });

  it('ends its own edge only after two reads in distinct runs omit the person', () => {
    const own = [edge('own-1')];
    expect(
      planCodeLaneDirectorRetirement({ reads: [read(2, null)], ownEdges: own, llmEdges: [] }),
    ).toMatchObject({ retiredEdgeIds: [], edgesAwaitingSecondRead: 1 });
    expect(
      planCodeLaneDirectorRetirement({
        reads: [read(2, null), read(3, ORLA)],
        ownEdges: own,
        llmEdges: [],
      }).retiredEdgeIds,
    ).toEqual(['own-1']);
    expect(
      planCodeLaneDirectorRetirement({
        reads: [read(2, null), read(3, null, [QUILL, ORLA]), read(4, null)],
        ownEdges: own,
        llmEdges: [],
      }).retiredEdgeIds,
    ).toEqual([]);
  });
});

describe('codeLaneDirectorReadFromSnapshot', () => {
  const snapshot = (overrides: { pagesRead?: number; cacheAllowed?: boolean } = {}) =>
    centerDirectorReadSnapshotObservation({
      centerEntityKey: 'center-widget',
      sourceUrl: 'https://widget.yale.edu/',
      stated: [QUILL, ORLA],
      settled: null,
      pagesRead: overrides.pagesRead ?? 2,
      cacheAllowed: overrides.cacheAllowed ?? false,
      readAt: day(2),
    }).value as CenterDirectorReadSnapshot;

  it('admits a fresh read that fetched a page, whoever it states', () => {
    expect(codeLaneDirectorReadFromSnapshot(snapshot(), 'run-2', day(2))).toEqual({
      scrapeRunId: 'run-2',
      observedAt: day(2),
      settled: null,
      stated: [ORLA, QUILL],
    });
  });

  it('refuses a cache-permitted read and a read of no page', () => {
    expect(
      codeLaneDirectorReadFromSnapshot(snapshot({ cacheAllowed: true }), 'run-2', day(2)),
    ).toBeNull();
    expect(
      codeLaneDirectorReadFromSnapshot(snapshot({ pagesRead: 0 }), 'run-2', day(2)),
    ).toBeNull();
  });
});
