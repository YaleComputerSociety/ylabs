import { describe, expect, it } from 'vitest';
import {
  planResearchEntityKindResync,
  summarizeResearchEntityKindResync,
} from '../resyncResearchEntityKindCore';

describe('resyncResearchEntityKindCore', () => {
  it('plans a resync only when the stored kind disagrees with the entity type', () => {
    const plan = planResearchEntityKindResync([
      { id: 1, slug: 'imaging-core', entityType: 'CORE_FACILITY', kind: 'lab' },
      { id: 2, slug: 'already-core', entityType: 'CORE_FACILITY', kind: 'core_facility' },
      { id: 3, slug: 'a-lab', entityType: 'LAB', kind: 'lab' },
    ]);

    expect(plan).toEqual([
      {
        id: 1,
        slug: 'imaging-core',
        entityType: 'CORE_FACILITY',
        kindFrom: 'lab',
        kindTo: 'core_facility',
      },
    ]);
  });

  it('skips rows whose entity type is missing or unknown', () => {
    const plan = planResearchEntityKindResync([
      { id: 1, slug: 'no-type', kind: 'lab' },
      { id: 2, slug: 'bad-type', entityType: 'NOT_A_TYPE', kind: 'lab' },
    ]);

    expect(plan).toEqual([]);
  });

  it('treats a missing stored kind as a disagreement to resync', () => {
    const plan = planResearchEntityKindResync([{ id: 1, slug: 'center', entityType: 'CENTER' }]);

    expect(plan).toEqual([
      { id: 1, slug: 'center', entityType: 'CENTER', kindFrom: '', kindTo: 'center' },
    ]);
  });

  it('summarizes planned counts grouped by entity type', () => {
    const plan = planResearchEntityKindResync([
      { id: 1, slug: 'a', entityType: 'CORE_FACILITY', kind: 'lab' },
      { id: 2, slug: 'b', entityType: 'CORE_FACILITY', kind: 'group' },
      { id: 3, slug: 'c', entityType: 'INSTITUTE', kind: 'lab' },
    ]);

    expect(summarizeResearchEntityKindResync(5, plan)).toEqual({
      scanned: 5,
      planned: 3,
      byEntityType: { CORE_FACILITY: 2, INSTITUTE: 1 },
    });
  });
});
