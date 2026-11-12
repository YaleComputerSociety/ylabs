import { describe, expect, it, vi } from 'vitest';
import type { ResearchEntityPiDedupeRow } from '../researchEntityPiDedupeCore';

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/studentVisibilityGateService', () => ({
  runStudentVisibilityGate: vi.fn(async () => ({ counts: { scanned: 0 } })),
}));

import {
  buildEponymousFraLabMergePairs,
  countCenterGuardedPis,
  parseBallotFoldPairs,
  parseEponymousFraLabMergeStageArgs,
  planEponymousFraLabMerges,
  runEponymousFraLabMergeStage,
  DEFAULT_EPONYMOUS_FRA_MERGE_MAX,
} from '../researchEntityEponymousMergeStage';
import { emptyResearchPlanCarryReport } from '../../services/researchPlanMergeCarry';

function eponymousShellRow(
  overrides: Partial<ResearchEntityPiDedupeRow> = {},
): ResearchEntityPiDedupeRow {
  return {
    userId: 'pi-ada-lovelace',
    normalizedName: 'same-pi:pi-ada-lovelace',
    piFirstName: 'Ada',
    piLastName: 'Lovelace',
    entities: [
      {
        id: 'lovelace-lab',
        slug: 'ysm-lovelace',
        name: 'Lovelace Laboratory',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/lab/lovelace/',
        sourceUrls: ['https://medicine.yale.edu/lab/lovelace/'],
        departments: ['Computer Science'],
      },
      {
        id: 'lovelace-fra-shell',
        slug: 'faculty-research-area-ada-lovelace',
        name: 'Ada Lovelace Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://medicine.yale.edu/profile/ada-lovelace/'],
        departments: ['Computer Science'],
      },
    ],
    ...overrides,
  };
}

function centerOnlyRow(): ResearchEntityPiDedupeRow {
  return {
    userId: 'pi-grace-hopper',
    normalizedName: 'same-pi:pi-grace-hopper',
    piFirstName: 'Grace',
    piLastName: 'Hopper',
    entities: [
      {
        id: 'hopper-center',
        slug: 'ysm-hopper-center',
        name: 'Hopper Center for Computing',
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: 'https://medicine.yale.edu/hopper-center/',
        sourceUrls: ['https://medicine.yale.edu/hopper-center/'],
        departments: ['Computer Science'],
      },
      {
        id: 'hopper-fra-shell',
        slug: 'faculty-research-area-grace-hopper',
        name: 'Grace Hopper Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://medicine.yale.edu/profile/grace-hopper/'],
        departments: ['Computer Science'],
      },
    ],
  };
}

describe('parseEponymousFraLabMergeStageArgs', () => {
  it('parses since, max-merges and apply flags', () => {
    const args = parseEponymousFraLabMergeStageArgs([
      '--apply',
      '--confirm-auto-merge-eponymous-fra',
      '--since',
      '2026-08-26T00:00:00.000Z',
      '--max-merges',
      '12',
    ]);
    expect(args).toMatchObject({
      apply: true,
      confirm: true,
      sinceIso: '2026-08-26T00:00:00.000Z',
      maxMerges: 12,
    });
  });

  it('defaults to dry-run with the default cap', () => {
    const args = parseEponymousFraLabMergeStageArgs(['--since', '2026-08-26T00:00:00.000Z']);
    expect(args.apply).toBe(false);
    expect(args.maxMerges).toBe(DEFAULT_EPONYMOUS_FRA_MERGE_MAX);
  });

  it('rejects a non-integer cap', () => {
    expect(() => parseEponymousFraLabMergeStageArgs(['--max-merges', 'lots'])).toThrow();
  });
});

describe('planEponymousFraLabMerges', () => {
  it('caps the selected eponymous groups to max-merges', () => {
    const rows = [
      eponymousShellRow(),
      eponymousShellRow({
        userId: 'pi-katherine-johnson',
        normalizedName: 'same-pi:pi-katherine-johnson',
        piFirstName: 'Katherine',
        piLastName: 'Johnson',
        entities: [
          {
            id: 'johnson-lab',
            slug: 'ysm-johnson',
            name: 'Johnson Laboratory',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/johnson/',
            sourceUrls: ['https://medicine.yale.edu/lab/johnson/'],
            departments: ['Astronomy'],
          },
          {
            id: 'johnson-fra-shell',
            slug: 'faculty-research-area-katherine-johnson',
            name: 'Katherine Johnson Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://medicine.yale.edu/profile/katherine-johnson/'],
            departments: ['Astronomy'],
          },
        ],
      }),
    ];
    const { plannedGroups, cappedGroups } = planEponymousFraLabMerges(rows, 1);
    expect(plannedGroups).toHaveLength(2);
    expect(cappedGroups).toHaveLength(1);
  });
});

describe('countCenterGuardedPis', () => {
  it('counts PIs whose only home is a center that the FRA cannot merge into', () => {
    expect(countCenterGuardedPis([centerOnlyRow(), eponymousShellRow()])).toBe(1);
  });
});

describe('buildEponymousFraLabMergePairs', () => {
  it('maps each merged group to fra->lab slug pairs', () => {
    const rows = [eponymousShellRow()];
    const { cappedGroups } = planEponymousFraLabMerges(rows, 10);
    const pairs = buildEponymousFraLabMergePairs(cappedGroups, rows);
    expect(pairs).toEqual([
      {
        piUserId: 'pi-ada-lovelace',
        fraEntityId: 'lovelace-fra-shell',
        fraSlug: 'faculty-research-area-ada-lovelace',
        labEntityId: 'lovelace-lab',
        labSlug: 'ysm-lovelace',
      },
    ]);
  });
});

const keepEveryGroup = async <T>(groups: readonly T[]) => ({ kept: [...groups], refused: [] });

describe('runEponymousFraLabMergeStage', () => {
  it('is a no-op in dry-run: reports the plan without applying', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
    }));
    const previewResearchPlanCarry = vi.fn(async () => ({
      ...emptyResearchPlanCarryReport(),
      plansOnDuplicates: 2,
      moved: 1,
      merged: 1,
    }));
    const delta = await runEponymousFraLabMergeStage({
      apply: false,
      maxMerges: 10,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => [eponymousShellRow()],
      partitionByDistinctPeople: keepEveryGroup,
      applyMergeGroup,
      previewResearchPlanCarry,
    });
    expect(applyMergeGroup).not.toHaveBeenCalled();
    expect(delta.plannedMergeCount).toBe(1);
    expect(delta.appliedMergeCount).toBe(0);
    expect(delta.mergedPairs).toHaveLength(1);
    expect(previewResearchPlanCarry).toHaveBeenCalledWith([
      expect.objectContaining({
        canonicalEntityId: 'lovelace-lab',
        duplicateEntityIds: ['lovelace-fra-shell'],
      }),
    ]);
    expect(delta.researchPlansThatWouldMove).toBe(2);
  });

  it('reports the plans each applied merge carried', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
      researchPlanCarry: { ...emptyResearchPlanCarryReport(), plansOnDuplicates: 1, moved: 1 },
    }));
    const previewResearchPlanCarry = vi.fn();
    const delta = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 10,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => [eponymousShellRow()],
      partitionByDistinctPeople: keepEveryGroup,
      applyMergeGroup,
      previewResearchPlanCarry,
    });
    expect(previewResearchPlanCarry).not.toHaveBeenCalled();
    expect(delta.researchPlanCarry.moved).toBe(1);
    expect(delta.researchPlansThatWouldMove).toBe(1);
  });

  it('applies exactly one merge and reports the merge delta when enabled', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
    }));
    const delta = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 10,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => [eponymousShellRow()],
      partitionByDistinctPeople: keepEveryGroup,
      applyMergeGroup,
    });
    expect(applyMergeGroup).toHaveBeenCalledTimes(1);
    expect(delta.appliedMergeCount).toBe(1);
    expect(delta.plannedMergeCount).toBe(1);
    expect(delta.deferredByCapCount).toBe(0);
    expect(delta.mergedPairs[0]).toMatchObject({
      fraSlug: 'faculty-research-area-ada-lovelace',
      labSlug: 'ysm-lovelace',
    });
  });

  it('defers over-cap merges and reports the deferred count', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
    }));
    const rows = [
      eponymousShellRow(),
      eponymousShellRow({
        userId: 'pi-katherine-johnson',
        normalizedName: 'same-pi:pi-katherine-johnson',
        piFirstName: 'Katherine',
        piLastName: 'Johnson',
        entities: [
          {
            id: 'johnson-lab',
            slug: 'ysm-johnson',
            name: 'Johnson Laboratory',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/johnson/',
            sourceUrls: ['https://medicine.yale.edu/lab/johnson/'],
            departments: ['Astronomy'],
          },
          {
            id: 'johnson-fra-shell',
            slug: 'faculty-research-area-katherine-johnson',
            name: 'Katherine Johnson Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://medicine.yale.edu/profile/katherine-johnson/'],
            departments: ['Astronomy'],
          },
        ],
      }),
    ];
    const delta = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 1,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => rows,
      partitionByDistinctPeople: keepEveryGroup,
      applyMergeGroup,
    });
    expect(applyMergeGroup).toHaveBeenCalledTimes(1);
    expect(delta.plannedMergeCount).toBe(2);
    expect(delta.appliedMergeCount).toBe(1);
    expect(delta.deferredByCapCount).toBe(1);
  });

  it('is a no-op when the scope holds no eponymous pair', async () => {
    const applyMergeGroup = vi.fn();
    const delta = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 10,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => [centerOnlyRow()],
      partitionByDistinctPeople: keepEveryGroup,
      applyMergeGroup,
    });
    expect(applyMergeGroup).not.toHaveBeenCalled();
    expect(delta.plannedMergeCount).toBe(0);
    expect(delta.appliedMergeCount).toBe(0);
    expect(delta.centerGuardedPiCount).toBe(1);
  });

  it('does not apply a merge the recorded distinct-people verdicts refuse', async () => {
    const applyMergeGroup = vi.fn();
    const delta = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 10,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => [eponymousShellRow()],
      applyMergeGroup,
      partitionByDistinctPeople: async (groups) => ({
        kept: [],
        refused: groups.map((group) => ({
          group,
          joinedVerdictPairs: [['person-a', 'person-b'] as const],
        })),
      }),
    });
    expect(applyMergeGroup).not.toHaveBeenCalled();
    expect(delta.plannedMergeCount).toBe(0);
    expect(delta.refusedAsDistinctPeopleCount).toBe(1);
  });
});

describe('ballot fold pairs (#5969)', () => {
  it('reads the ballot pairs file flag and refuses an incomplete pair', () => {
    expect(
      parseEponymousFraLabMergeStageArgs([
        '--since=2026-01-01T00:00:00Z',
        '--ballot-pairs',
        '/tmp/ballot.json',
      ]).ballotPairsFile,
    ).toBe('/tmp/ballot.json');
    expect(parseBallotFoldPairs([{ label: 'P99', facultyRowId: 'a', labId: 'b' }])).toEqual([
      { label: 'P99', facultyRowId: 'a', labId: 'b' },
    ]);
    expect(() => parseBallotFoldPairs([{ label: 'P99', facultyRowId: 'a' }])).toThrow(/labId/);
    expect(() => parseBallotFoldPairs({})).toThrow(/JSON array/);
  });
});

describe('witnessed folds the stage cannot plan (#5969)', () => {
  const witnessContext = async () => ({
    entities: new Map(
      [
        { id: 'row-1', entityType: 'FACULTY_RESEARCH_AREA', slug: 'row-1', name: 'Row One' },
        { id: 'row-2', entityType: 'INDIVIDUAL_RESEARCH', slug: 'row-2', name: 'Row Two' },
        { id: 'lab-1', entityType: 'LAB', slug: 'lab-1', name: 'Tidal Lab' },
        { id: 'lab-2', entityType: 'LAB', slug: 'lab-2', name: 'Delta Lab' },
      ].map((entity) => [entity.id, entity]),
    ),
    edges: ['row-1', 'row-2', 'lab-1', 'lab-2'].flatMap((entityId) => [
      { personId: 'pi-x', entityId, role: 'PI', evidenced: true },
    ]),
  });
  const pairs = [
    { label: 'B1', facultyRowId: 'row-1', labId: 'lab-1' },
    { label: 'B2', facultyRowId: 'row-2', labId: 'lab-1' },
  ];

  it('reports a second row folding into a lab already folding, and one the cap defers', async () => {
    const delta = await runEponymousFraLabMergeStage({
      apply: false,
      sinceIso: '2026-08-26T00:00:00.000Z',
      maxMerges: 0,
      loadRows: async () => [],
      partitionByDistinctPeople: keepEveryGroup,
      previewResearchPlanCarry: async () => emptyResearchPlanCarryReport(),
      loadWitnessContext: witnessContext,
      ballotPairs: pairs,
    });
    expect(delta.witnessedFolds).toEqual([]);
    expect(delta.witnessedFoldRefusals.map((refusal) => [refusal.label, refusal.reason])).toEqual(
      expect.arrayContaining([
        ['B1', 'deferred-by-cap'],
        ['B2', 'lab-already-folding'],
      ]),
    );
  });

  it('reports a fold the distinct-people verdicts refuse instead of listing it as planned', async () => {
    const delta = await runEponymousFraLabMergeStage({
      apply: false,
      sinceIso: '2026-08-26T00:00:00.000Z',
      maxMerges: 10,
      loadRows: async () => [],
      partitionByDistinctPeople: async (groups) => ({
        kept: [],
        refused: groups.map((group) => ({
          group,
          joinedVerdictPairs: [['person-a', 'person-b'] as const],
        })),
      }),
      previewResearchPlanCarry: async () => emptyResearchPlanCarryReport(),
      loadWitnessContext: witnessContext,
      ballotPairs: [pairs[0]],
    });
    expect(delta.witnessedFolds).toEqual([]);
    expect(delta.witnessedFoldRefusals.map((refusal) => [refusal.label, refusal.reason])).toEqual([
      ['B1', 'refused-as-distinct-people'],
    ]);
  });

  it('reports a fold whose lab the eponymous lane already plans', async () => {
    const delta = await runEponymousFraLabMergeStage({
      apply: false,
      sinceIso: '2026-08-26T00:00:00.000Z',
      maxMerges: 10,
      loadRows: async () => [eponymousShellRow()],
      partitionByDistinctPeople: keepEveryGroup,
      previewResearchPlanCarry: async () => emptyResearchPlanCarryReport(),
      loadWitnessContext: async () => ({
        entities: new Map([
          ['row-1', { id: 'row-1', entityType: 'FACULTY_RESEARCH_AREA', slug: 'row-1' }],
          ['lovelace-lab', { id: 'lovelace-lab', entityType: 'LAB', slug: 'ysm-lovelace' }],
        ]),
        edges: [
          { personId: 'pi-ada-lovelace', entityId: 'row-1', role: 'PI', evidenced: true },
          { personId: 'pi-ada-lovelace', entityId: 'lovelace-lab', role: 'PI', evidenced: true },
        ],
      }),
      ballotPairs: [{ label: 'B3', facultyRowId: 'row-1', labId: 'lovelace-lab' }],
    });
    expect(delta.witnessedFolds).toEqual([]);
    expect(delta.witnessedFoldRefusals.map((refusal) => [refusal.label, refusal.reason])).toEqual([
      ['B3', 'planned-by-eponymous-lane'],
    ]);
  });
});
