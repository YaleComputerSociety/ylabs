import { describe, expect, it } from 'vitest';

import {
  compareNewestSavedFirst,
  countPlansByStage,
  orderStably,
  parsePlanListView,
  planMatchesStageFilter,
  planSortOptions,
  writePlanListView,
} from '../dashboardPlanListView';

describe('dashboard plan list view', () => {
  it('parses the preset, an offered stage, and a sort from the URL', () => {
    expect(parsePlanListView(new URLSearchParams('stage=waiting&sort=stage'), 'research')).toEqual({
      stageFilter: 'waiting',
      sort: 'stage',
    });
    expect(
      parsePlanListView(new URLSearchParams('stage=applied&sort=deadline'), 'program'),
    ).toEqual({ stageFilter: 'APPLIED', sort: 'deadline' });
  });

  it('falls back to the default for values the surface does not offer', () => {
    expect(parsePlanListView(new URLSearchParams('stage=contacted&sort=x'), 'program')).toEqual({
      stageFilter: 'all',
      sort: 'recent',
    });
    expect(
      parsePlanListView(new URLSearchParams('stage=APPLIED&sort=deadline'), 'research'),
    ).toEqual({ stageFilter: 'all', sort: 'recent' });
  });

  it('writes nothing for the default view and lower-cases a stage', () => {
    const params = new URLSearchParams('tab=programs&stage=saved&sort=stage');
    writePlanListView(params, { stageFilter: 'all', sort: 'recent' });
    expect(params.toString()).toBe('tab=programs');

    writePlanListView(params, { stageFilter: 'NOT_SELECTED', sort: 'deadline' });
    expect(params.toString()).toBe('tab=programs&stage=not_selected&sort=deadline');
  });

  it('covers Contacted and Applied on research and Applied alone on programs', () => {
    expect(planMatchesStageFilter('CONTACTED', 'waiting', 'research')).toBe(true);
    expect(planMatchesStageFilter('APPLIED', 'waiting', 'research')).toBe(true);
    expect(planMatchesStageFilter('PREPARING', 'waiting', 'research')).toBe(false);
    expect(planMatchesStageFilter('APPLIED', 'waiting', 'program')).toBe(true);
    expect(planMatchesStageFilter('CONTACTED', 'waiting', 'program')).toBe(false);
    expect(planMatchesStageFilter('AWARDED', 'waiting', 'program')).toBe(false);
  });

  it('offers the deadline sort only on programs', () => {
    expect(planSortOptions('research').map((option) => option.label)).toEqual([
      'Recently saved',
      'Stage',
    ]);
    expect(planSortOptions('program').map((option) => option.label)).toEqual([
      'Recently saved',
      'Stage',
      'Deadline',
    ]);
  });

  it('orders newest saved first, undated last, and keeps ties in their given order', () => {
    const rows = [
      { id: 'a', createdAt: undefined },
      { id: 'b', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c', createdAt: 'not-a-date' },
      { id: 'd', createdAt: '2026-05-01T00:00:00Z' },
      { id: 'e', createdAt: '2026-01-01T00:00:00Z' },
    ];
    expect(
      orderStably(rows, (x, y) => compareNewestSavedFirst(x.createdAt, y.createdAt)).map(
        (row) => row.id,
      ),
    ).toEqual(['d', 'b', 'e', 'a', 'c']);
  });

  it('counts each stage and the preset', () => {
    expect(countPlansByStage(['SAVED', 'CONTACTED', 'APPLIED', 'APPLIED'], 'research')).toEqual({
      total: 4,
      waiting: 3,
      byStage: { SAVED: 1, CONTACTED: 1, APPLIED: 2 },
    });
  });
});
