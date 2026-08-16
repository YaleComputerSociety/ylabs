import { describe, expect, it } from 'vitest';
import { buildArchivedResearchEntityCleanupPlan } from '../cleanupArchivedResearchEntitiesCore';

describe('buildArchivedResearchEntityCleanupPlan', () => {
  it('marks archived entities with no live references as eligible', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [] },
        { id: 'b', liveReferences: [{ collection: 'access_signals', field: 'researchEntityId', count: 0 }] },
      ],
    });
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 2, blockedCount: 0 });
    expect(plan.eligible).toEqual(['a', 'b']);
    expect(plan.blocked).toEqual([]);
  });

  it('fails closed by blocking entities that still have a live reference', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [] },
        {
          id: 'b',
          name: 'Blocked Home',
          slug: 'blocked-home',
          liveReferences: [{ collection: 'posted_opportunities', field: 'researchEntityId', count: 3 }],
        },
      ],
    });
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 1, blockedCount: 1 });
    expect(plan.eligible).toEqual(['a']);
    expect(plan.blocked).toEqual([
      {
        id: 'b',
        name: 'Blocked Home',
        slug: 'blocked-home',
        references: [{ collection: 'posted_opportunities', field: 'researchEntityId', count: 3 }],
      },
    ]);
  });

  it('handles an empty candidate set', () => {
    expect(buildArchivedResearchEntityCleanupPlan({ candidates: [] })).toEqual({
      scanned: 0,
      eligibleCount: 0,
      blockedCount: 0,
      eligible: [],
      blocked: [],
    });
  });
});
