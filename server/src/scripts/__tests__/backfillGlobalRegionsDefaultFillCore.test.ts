import { describe, expect, it } from 'vitest';
import { TOP_LEVEL_GLOBAL_REGIONS } from '../../services/globalRegions';
import { planGlobalRegionsDefaultFillCollapse } from '../backfillGlobalRegionsDefaultFillCore';

const ALL_SEVEN = [...TOP_LEVEL_GLOBAL_REGIONS];

describe('planGlobalRegionsDefaultFillCollapse', () => {
  it('flags only full-enumeration records for collapse and moves them into the zero bucket', () => {
    const plan = planGlobalRegionsDefaultFillCollapse([
      { id: 'a', title: 'Catch-all Scholarship', globalRegions: ALL_SEVEN },
      { id: 'b', title: 'Two-region Grant', globalRegions: ['Africa', 'Asia'] },
      { id: 'c', title: 'Region-agnostic College Grant', globalRegions: [] },
      { id: 'd', title: 'Another Catch-all', globalRegions: [...ALL_SEVEN].reverse() },
    ]);

    expect(plan.scanned).toBe(4);
    expect(plan.toCollapse.map((row) => row.id)).toEqual(['a', 'd']);
    expect(plan.histogramBefore).toEqual({ '0': 1, '2': 1, '7': 2 });
    expect(plan.histogramAfter).toEqual({ '0': 3, '2': 1 });
  });

  it('produces an empty plan when nothing is default-filled', () => {
    const plan = planGlobalRegionsDefaultFillCollapse([
      { id: 'a', title: 'Africa Grant', globalRegions: ['Africa'] },
      { id: 'b', title: 'Empty Grant', globalRegions: [] },
    ]);

    expect(plan.toCollapse).toEqual([]);
    expect(plan.histogramBefore).toEqual({ '0': 1, '1': 1 });
    expect(plan.histogramAfter).toEqual({ '0': 1, '1': 1 });
  });
});
