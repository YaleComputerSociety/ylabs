import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_REASON_ABSENT,
  buildArchivedEntityArtifactRepairPlan,
  dispositionMatchesScope,
  resolveArchivedEntityDispositions,
  summarizeArchivedEntityArtifactRepairPlanByClass,
  type ArchivedEntityArtifact,
  type ArchivedEntityDisposition,
  type ArchivedEntityNode,
} from '../repairArchivedEntityArtifactsCore';

const LOSER = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const MIDDLE = 'aaaaaaaaaaaaaaaaaaaaaaa2';
const SURVIVOR = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const ORPHAN = 'aaaaaaaaaaaaaaaaaaaaaaa3';
const DEAD_END = 'aaaaaaaaaaaaaaaaaaaaaaa4';
const MISSING = 'ccccccccccccccccccccccc1';
const NO_HOME = 'aaaaaaaaaaaaaaaaaaaaaaa5';
const TERMINAL = 'aaaaaaaaaaaaaaaaaaaaaaa6';

function nodes(list: ArchivedEntityNode[]): Map<string, ArchivedEntityNode> {
  return new Map(list.map((node) => [node.id, node]));
}

function mergeDisposition(archivedEntityId: string, survivorId: string): ArchivedEntityDisposition {
  return {
    archivedEntityId,
    repairClass: 'merge-survivor',
    survivorId,
    archivedReason: 'synthetic-merge',
  };
}

describe('resolveArchivedEntityDispositions', () => {
  it('follows a multi-hop tombstone chain to the live survivor', async () => {
    const archived: ArchivedEntityNode[] = [
      { id: LOSER, archived: true, canonicalGroupId: MIDDLE, archivedReason: 'synthetic-merge' },
      { id: MIDDLE, archived: true, canonicalGroupId: SURVIVOR },
      { id: ORPHAN, archived: true, archivedReason: '  ' },
      { id: DEAD_END, archived: true, canonicalGroupId: MISSING },
      { id: NO_HOME, archived: true, canonicalGroupId: TERMINAL },
      { id: TERMINAL, archived: true },
    ];
    const dispositions = await resolveArchivedEntityDispositions(
      archived,
      nodes([...archived, { id: SURVIVOR, archived: false }]),
    );

    expect(dispositions.get(LOSER)).toMatchObject({
      repairClass: 'merge-survivor',
      survivorId: SURVIVOR,
      archivedReason: 'synthetic-merge',
    });
    expect(dispositions.get(MIDDLE)).toMatchObject({
      repairClass: 'merge-survivor',
      survivorId: SURVIVOR,
      archivedReason: ARCHIVED_REASON_ABSENT,
    });
    expect(dispositions.get(ORPHAN)).toMatchObject({
      repairClass: 'no-canonical',
      archivedReason: ARCHIVED_REASON_ABSENT,
    });
    expect(dispositions.get(DEAD_END)).toMatchObject({
      repairClass: 'merge-dead-end',
      terminalCause: 'absent_target',
    });
    expect(dispositions.get(DEAD_END)?.survivorId).toBeUndefined();
    expect(dispositions.get(NO_HOME)).toMatchObject({
      repairClass: 'merge-no-live-home',
      terminalCause: 'archived_terminal',
    });
  });

  it('treats a tombstone cycle as a dead end rather than a survivor', async () => {
    const archived: ArchivedEntityNode[] = [
      { id: LOSER, archived: true, canonicalGroupId: MIDDLE },
      { id: MIDDLE, archived: true, canonicalGroupId: LOSER },
    ];
    const dispositions = await resolveArchivedEntityDispositions(archived, nodes(archived));

    expect(dispositions.get(LOSER)?.repairClass).toBe('merge-dead-end');
    expect(dispositions.get(MIDDLE)?.repairClass).toBe('merge-dead-end');
  });
});

describe('dispositionMatchesScope', () => {
  const disposition: ArchivedEntityDisposition = {
    archivedEntityId: LOSER,
    repairClass: 'no-canonical',
    archivedReason: 'synthetic-retire',
    archivedAt: new Date('2026-09-26T12:00:00.000Z'),
  };

  it('matches every disposition when the scope is empty', () => {
    expect(dispositionMatchesScope(disposition, {})).toBe(true);
  });

  it('narrows by class, archive reason, entity id, and archive window', () => {
    expect(dispositionMatchesScope(disposition, { classes: new Set(['merge-survivor']) })).toBe(
      false,
    );
    expect(dispositionMatchesScope(disposition, { classes: new Set(['no-canonical']) })).toBe(true);
    expect(
      dispositionMatchesScope(disposition, { archivedReasons: new Set(['synthetic-other']) }),
    ).toBe(false);
    expect(dispositionMatchesScope(disposition, { entityIds: new Set([ORPHAN]) })).toBe(false);
    expect(
      dispositionMatchesScope(disposition, {
        archivedSince: new Date('2026-09-26T00:00:00.000Z'),
        archivedBefore: new Date('2026-09-27T00:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      dispositionMatchesScope(disposition, {
        archivedBefore: new Date('2026-09-26T12:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('excludes a row with no recorded archive time from any date window', () => {
    expect(
      dispositionMatchesScope(
        { ...disposition, archivedAt: undefined },
        { archivedSince: new Date('2000-01-01T00:00:00.000Z') },
      ),
    ).toBe(false);
  });
});

describe('buildArchivedEntityArtifactRepairPlan', () => {
  it('relinks a role edge to the survivor when the survivor has no matching edge', () => {
    const artifacts: ArchivedEntityArtifact[] = [
      {
        artifactType: 'RoleAssignment',
        id: 'edge-loser',
        researchEntityId: LOSER,
        personId: 'person-1',
        role: 'PI',
      },
    ];

    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts,
      dispositions: new Map([[LOSER, mergeDisposition(LOSER, SURVIVOR)]]),
    });

    expect(plan.relink).toEqual([
      {
        artifactType: 'RoleAssignment',
        repairClass: 'merge-survivor',
        archivedEntityId: LOSER,
        archivedReason: 'synthetic-merge',
        id: 'edge-loser',
        canonicalResearchEntityId: SURVIVOR,
      },
    ]);
    expect(plan.mergeAndArchive).toEqual([]);
  });

  it('archives a role edge the survivor already carries for the same person and role', () => {
    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts: [
        {
          artifactType: 'RoleAssignment',
          id: 'edge-loser',
          researchEntityId: LOSER,
          personId: 'person-1',
          role: 'PI',
        },
        {
          artifactType: 'RoleAssignment',
          id: 'edge-loser-other-role',
          researchEntityId: LOSER,
          personId: 'person-1',
          role: 'DIRECTOR',
        },
      ],
      canonicalArtifacts: [
        {
          artifactType: 'RoleAssignment',
          id: 'edge-survivor',
          researchEntityId: SURVIVOR,
          personId: 'person-1',
          role: 'PI',
        },
      ],
      dispositions: new Map([[LOSER, mergeDisposition(LOSER, SURVIVOR)]]),
    });

    expect(plan.mergeAndArchive).toEqual([
      expect.objectContaining({
        duplicateId: 'edge-loser',
        canonicalId: 'edge-survivor',
        canonicalResearchEntityId: SURVIVOR,
      }),
    ]);
    expect(plan.relink.map((item) => item.id)).toEqual(['edge-loser-other-role']);
  });

  it('never relinks two losers onto the same survivor identity', () => {
    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts: [
        {
          artifactType: 'RoleAssignment',
          id: 'edge-a',
          researchEntityId: LOSER,
          personId: 'person-1',
          role: 'PI',
        },
        {
          artifactType: 'RoleAssignment',
          id: 'edge-b',
          researchEntityId: MIDDLE,
          personId: 'person-1',
          role: 'PI',
        },
      ],
      dispositions: new Map([
        [LOSER, mergeDisposition(LOSER, SURVIVOR)],
        [MIDDLE, mergeDisposition(MIDDLE, SURVIVOR)],
      ]),
    });

    expect(plan.relink.map((item) => item.id)).toEqual(['edge-a']);
    expect(plan.mergeAndArchive).toEqual([
      expect.objectContaining({ duplicateId: 'edge-b', canonicalId: 'edge-a' }),
    ]);
  });

  it('uses signal type plus derivation key as the access-signal identity', () => {
    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts: [
        {
          artifactType: 'AccessSignal',
          id: 'signal-loser',
          researchEntityId: LOSER,
          signalType: 'REACH_OUT_PLAUSIBLE',
          derivationKey: 'signal:shared',
        },
      ],
      canonicalArtifacts: [
        {
          artifactType: 'AccessSignal',
          id: 'signal-survivor-other-type',
          researchEntityId: SURVIVOR,
          signalType: 'CURRENT_UNDERGRADS',
          derivationKey: 'signal:shared',
        },
      ],
      dispositions: new Map([[LOSER, mergeDisposition(LOSER, SURVIVOR)]]),
    });

    expect(plan.relink.map((item) => item.id)).toEqual(['signal-loser']);
  });

  it('retires artifacts on a row with no canonical and skips a dead-end chain', () => {
    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts: [
        { artifactType: 'AccessSignal', id: 'signal-orphan', researchEntityId: ORPHAN },
        { artifactType: 'RoleAssignment', id: 'edge-dead-end', researchEntityId: DEAD_END },
      ],
      dispositions: new Map<string, ArchivedEntityDisposition>([
        [
          ORPHAN,
          { archivedEntityId: ORPHAN, repairClass: 'no-canonical', archivedReason: 'retired' },
        ],
        [
          DEAD_END,
          {
            archivedEntityId: DEAD_END,
            repairClass: 'merge-dead-end',
            archivedReason: ARCHIVED_REASON_ABSENT,
          },
        ],
      ]),
    });

    expect(plan.archiveWithoutCanonical).toEqual([
      expect.objectContaining({ id: 'signal-orphan', repairClass: 'no-canonical' }),
    ]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ id: 'edge-dead-end', reason: 'merge-chain-dead-end' }),
    ]);
    expect(plan.relink).toEqual([]);
  });

  it('retires artifacts on a merged row whose chain ends on an archived row with no live home', () => {
    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts: [
        { artifactType: 'RoleAssignment', id: 'edge-no-home', researchEntityId: NO_HOME },
      ],
      dispositions: new Map<string, ArchivedEntityDisposition>([
        [
          NO_HOME,
          {
            archivedEntityId: NO_HOME,
            repairClass: 'merge-no-live-home',
            terminalCause: 'archived_terminal',
            archivedReason: ARCHIVED_REASON_ABSENT,
          },
        ],
      ]),
    });

    expect(plan.archiveWithoutCanonical).toEqual([
      expect.objectContaining({ id: 'edge-no-home', repairClass: 'merge-no-live-home' }),
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('summarizes the plan per class with archive reasons and artifact types', () => {
    const plan = buildArchivedEntityArtifactRepairPlan({
      artifacts: [
        {
          artifactType: 'RoleAssignment',
          id: 'edge-loser',
          researchEntityId: LOSER,
          personId: 'person-1',
          role: 'PI',
        },
        { artifactType: 'AccessSignal', id: 'signal-orphan', researchEntityId: ORPHAN },
        { artifactType: 'RoleAssignment', id: 'edge-orphan', researchEntityId: ORPHAN },
      ],
      dispositions: new Map<string, ArchivedEntityDisposition>([
        [LOSER, mergeDisposition(LOSER, SURVIVOR)],
        [
          ORPHAN,
          { archivedEntityId: ORPHAN, repairClass: 'no-canonical', archivedReason: 'retired' },
        ],
      ]),
    });

    expect(summarizeArchivedEntityArtifactRepairPlanByClass(plan)).toEqual({
      'merge-survivor': {
        relink: 1,
        mergeAndArchive: 0,
        archiveWithoutCanonical: 0,
        detachDisputed: 0,
        skipped: 0,
        archivedEntities: 1,
        byArtifactType: { RoleAssignment: 1 },
        byArchivedReason: { 'synthetic-merge': 1 },
      },
      'no-canonical': {
        relink: 0,
        mergeAndArchive: 0,
        archiveWithoutCanonical: 2,
        detachDisputed: 0,
        skipped: 0,
        archivedEntities: 1,
        byArtifactType: { AccessSignal: 1, RoleAssignment: 1 },
        byArchivedReason: { retired: 2 },
      },
    });
  });
});
