import { describe, expect, it } from 'vitest';
import {
  planFoldedShellEdgeHeals,
  planShellEdgeMoves,
  type FoldedShellEdge,
  type SurvivorHistoryEdge,
} from '../dedupeAccountlessResearcherShellsCore';

const targets = new Map([['shell', 'survivor']]);
const shellEdge = {
  id: 'e-shell',
  personId: 'shell',
  targetKind: 'RESEARCH_ENTITY',
  targetId: 'row',
  role: 'CORE_FACULTY',
  state: 'UNKNOWN',
};
const endedSurvivorEdge = {
  ...shellEdge,
  id: 'e-survivor',
  personId: 'survivor',
  state: 'HISTORICAL',
  archived: false,
};

describe('planShellEdgeMoves keeps a current membership the survivor only held in the past (#5990)', () => {
  it('repoints a current shell edge when the survivor edge on that key has ended', () => {
    const moves = planShellEdgeMoves([shellEdge], [endedSurvivorEdge], targets).get('shell');
    expect(moves).toEqual({ repointed: ['e-shell'], archivedRedundant: [] });
  });

  it('still archives a current shell edge beside a current survivor edge', () => {
    const currentSurvivorEdge = { ...endedSurvivorEdge, state: 'CURRENT' };
    const moves = planShellEdgeMoves([shellEdge], [currentSurvivorEdge], targets).get('shell');
    expect(moves).toEqual({ repointed: [], archivedRedundant: ['e-shell'] });
  });

  it('still archives a current shell edge beside a survivor edge an operator detached', () => {
    const detached = { ...endedSurvivorEdge, archived: true, reviewStatus: 'DISPUTED' };
    const moves = planShellEdgeMoves([shellEdge], [detached], targets).get('shell');
    expect(moves?.archivedRedundant).toEqual(['e-shell']);
  });

  it('keeps archiving a historical shell edge beside an ended survivor edge', () => {
    const historicalShellEdge = { ...shellEdge, state: 'HISTORICAL' };
    const moves = planShellEdgeMoves([historicalShellEdge], [endedSurvivorEdge], targets).get(
      'shell',
    );
    expect(moves).toEqual({ repointed: [], archivedRedundant: ['e-shell'] });
  });

  it('gives the survivor one current edge when two shells carry the same current membership', () => {
    const twoShells = new Map([
      ['shell', 'survivor'],
      ['shell-2', 'survivor'],
    ]);
    const second = { ...shellEdge, id: 'e-shell-2', personId: 'shell-2' };
    const moves = planShellEdgeMoves([shellEdge, second], [endedSurvivorEdge], twoShells);
    expect(moves.get('shell')?.repointed).toEqual(['e-shell']);
    expect(moves.get('shell-2')?.archivedRedundant).toEqual(['e-shell-2']);
  });
});

const foldedAt = new Date('2026-11-12T22:00:00Z');
const foldedShell = { id: 'shell', survivorId: 'survivor', dedupedAt: foldedAt };
const archivedCurrentEdge: FoldedShellEdge = {
  ...shellEdge,
  archived: true,
  reviewStatus: 'UNREVIEWED',
};
const survivorHistory: SurvivorHistoryEdge = {
  ...endedSurvivorEdge,
  endedAt: new Date('2026-11-01T00:00:00Z'),
};

const heals = (overrides: Partial<Parameters<typeof planFoldedShellEdgeHeals>[0]> = {}) =>
  planFoldedShellEdgeHeals({
    foldedShells: [foldedShell],
    archivedShellEdges: [archivedCurrentEdge],
    survivorEdges: [survivorHistory],
    liveSurvivorIds: new Set(['survivor']),
    liveTargetIds: new Set(['row']),
    auditedEdgeIds: new Set(),
    ...overrides,
  });

describe('planFoldedShellEdgeHeals restores what an earlier fold archived (#5990)', () => {
  it('re-points a current edge archived beside a survivor edge that had already ended', () => {
    expect(heals()).toEqual([
      {
        edgeId: 'e-shell',
        shellId: 'shell',
        survivorId: 'survivor',
        targetId: 'row',
        role: 'CORE_FACULTY',
      },
    ]);
  });

  it('restores only the latest fold of one membership', () => {
    const earlierShell = {
      id: 'shell-early',
      survivorId: 'survivor',
      dedupedAt: new Date('2026-11-05T00:00:00Z'),
    };
    const earlierEdge = { ...archivedCurrentEdge, id: 'e-early', personId: 'shell-early' };
    const planned = heals({
      foldedShells: [earlierShell, foldedShell],
      archivedShellEdges: [earlierEdge, archivedCurrentEdge],
    });
    expect(planned.map((heal) => heal.edgeId)).toEqual(['e-shell']);
  });

  it('restores no earlier twin when the latest fold of the membership is ineligible', () => {
    const earlierShell = {
      id: 'shell-early',
      survivorId: 'survivor',
      dedupedAt: new Date('2026-11-05T00:00:00Z'),
    };
    const earlierEdge = { ...archivedCurrentEdge, id: 'e-early', personId: 'shell-early' };
    const latestDisputed = { ...archivedCurrentEdge, reviewStatus: 'DISPUTED' };
    expect(
      heals({
        foldedShells: [earlierShell, foldedShell],
        archivedShellEdges: [earlierEdge, latestDisputed],
      }),
    ).toEqual([]);
    expect(
      heals({
        foldedShells: [earlierShell, foldedShell],
        archivedShellEdges: [earlierEdge, archivedCurrentEdge],
        auditedEdgeIds: new Set(['e-shell']),
      }),
    ).toEqual([]);
  });

  it('leaves an edge an operator detached', () => {
    expect(
      heals({ archivedShellEdges: [{ ...archivedCurrentEdge, reviewStatus: 'DISPUTED' }] }),
    ).toEqual([]);
  });

  it('leaves an edge any review touched or an audit record names', () => {
    expect(
      heals({ archivedShellEdges: [{ ...archivedCurrentEdge, reviewStatus: 'APPROVED' }] }),
    ).toEqual([]);
    expect(
      heals({ archivedShellEdges: [{ ...archivedCurrentEdge, reviewNotes: 'kept off' }] }),
    ).toEqual([]);
    expect(
      heals({ archivedShellEdges: [{ ...archivedCurrentEdge, reviewedBy: 'operator' }] }),
    ).toEqual([]);
    expect(heals({ auditedEdgeIds: new Set(['e-shell']) })).toEqual([]);
  });

  it('leaves a historical edge historical', () => {
    expect(
      heals({
        archivedShellEdges: [
          { ...archivedCurrentEdge, state: 'HISTORICAL', endedAt: new Date('2026-10-01') },
        ],
      }),
    ).toEqual([]);
    expect(
      heals({ archivedShellEdges: [{ ...archivedCurrentEdge, endedAt: new Date('2026-10-01') }] }),
    ).toEqual([]);
  });

  it('does nothing when the survivor already holds a current edge on the row', () => {
    const currentOnRow = { ...survivorHistory, id: 'e-pi', role: 'PI', state: 'CURRENT' };
    expect(heals({ survivorEdges: [survivorHistory, currentOnRow] })).toEqual([]);
  });

  it('does nothing on an archived row or for an archived survivor', () => {
    expect(heals({ liveTargetIds: new Set() })).toEqual([]);
    expect(heals({ liveSurvivorIds: new Set() })).toEqual([]);
  });

  it('does nothing when the survivor edge ended after the fold, so the fold was right', () => {
    const endedLater = { ...survivorHistory, endedAt: new Date('2026-11-13T00:00:00Z') };
    expect(heals({ survivorEdges: [endedLater] })).toEqual([]);
  });

  it('does nothing without an ended survivor edge on the same role', () => {
    expect(heals({ survivorEdges: [] })).toEqual([]);
    expect(heals({ survivorEdges: [{ ...survivorHistory, role: 'STAFF' }] })).toEqual([]);
  });

  it('finds nothing to heal once the edge is current on the survivor', () => {
    const healedEdge = { ...survivorHistory, id: 'e-shell', state: 'UNKNOWN', endedAt: undefined };
    expect(heals({ archivedShellEdges: [], survivorEdges: [survivorHistory, healedEdge] })).toEqual(
      [],
    );
    expect(heals({ survivorEdges: [survivorHistory, healedEdge] })).toEqual([]);
  });
});
