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
  isEponymousFraLabMergeStageEnabled,
  parseEponymousFraLabMergeStageArgs,
  planEponymousFraLabMerges,
  runEponymousFraLabMergeStage,
  DEFAULT_EPONYMOUS_FRA_MERGE_MAX,
} from '../researchEntityEponymousMergeStage';

function eponymousShellRow(overrides: Partial<ResearchEntityPiDedupeRow> = {}): ResearchEntityPiDedupeRow {
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

describe('isEponymousFraLabMergeStageEnabled', () => {
  it('defaults to disabled when the flag is unset', () => {
    expect(isEponymousFraLabMergeStageEnabled({})).toBe(false);
  });

  it('enables only for an explicit truthy flag value', () => {
    expect(isEponymousFraLabMergeStageEnabled({ SCRAPER_SWEEP_AUTO_MERGE_FRA: '1' })).toBe(true);
    expect(isEponymousFraLabMergeStageEnabled({ SCRAPER_SWEEP_AUTO_MERGE_FRA: 'true' })).toBe(true);
    expect(isEponymousFraLabMergeStageEnabled({ SCRAPER_SWEEP_AUTO_MERGE_FRA: '0' })).toBe(false);
    expect(isEponymousFraLabMergeStageEnabled({ SCRAPER_SWEEP_AUTO_MERGE_FRA: 'no' })).toBe(false);
  });
});

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

describe('runEponymousFraLabMergeStage', () => {
  it('is a no-op in dry-run: reports the plan without applying', async () => {
    const applyMergeGroup = vi.fn(async (group: { canonicalEntityId: string }) => ({
      canonicalEntityId: group.canonicalEntityId,
    }));
    const delta = await runEponymousFraLabMergeStage({
      apply: false,
      maxMerges: 10,
      sinceIso: '2026-08-26T00:00:00.000Z',
      loadRows: async () => [eponymousShellRow()],
      applyMergeGroup,
    });
    expect(applyMergeGroup).not.toHaveBeenCalled();
    expect(delta.plannedMergeCount).toBe(1);
    expect(delta.appliedMergeCount).toBe(0);
    expect(delta.mergedPairs).toHaveLength(1);
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
      applyMergeGroup,
    });
    expect(applyMergeGroup).not.toHaveBeenCalled();
    expect(delta.plannedMergeCount).toBe(0);
    expect(delta.appliedMergeCount).toBe(0);
    expect(delta.centerGuardedPiCount).toBe(1);
  });
});
