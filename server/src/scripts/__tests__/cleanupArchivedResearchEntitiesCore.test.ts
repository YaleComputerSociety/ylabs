import { describe, expect, it } from 'vitest';
import { buildArchivedResearchEntityCleanupPlan } from '../cleanupArchivedResearchEntitiesCore';

describe('buildArchivedResearchEntityCleanupPlan', () => {
  it('marks archived entities with no live references as eligible', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [] },
        { id: 'b', liveReferences: [{ collection: 'signals', field: 'researchEntityId', count: 0 }] },
      ],
    });
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 2, blockedCount: 0 });
    expect(plan.eligible).toEqual(['a', 'b']);
    expect(plan.blocked).toEqual([]);
    expect(plan.deferredByReason).toEqual({ has_live_references: 0, missing_redirect: 0 });
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
        reason: 'has_live_references',
        references: [{ collection: 'posted_opportunities', field: 'researchEntityId', count: 3 }],
      },
    ]);
    expect(plan.deferredByReason).toEqual({ has_live_references: 1, missing_redirect: 0 });
  });

  it('requires a redirect row when requireRedirect is set and defers residue without one', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      requireRedirect: true,
      candidates: [
        { id: 'with-redirect', slug: 'a', liveReferences: [], redirectPresent: true },
        { id: 'no-redirect', slug: 'b', liveReferences: [], redirectPresent: false },
        { id: 'redirect-undefined', slug: 'c', liveReferences: [] },
      ],
    });
    expect(plan.eligible).toEqual(['with-redirect']);
    expect(plan.blocked).toEqual([
      { id: 'no-redirect', slug: 'b', reason: 'missing_redirect', references: [] },
      { id: 'redirect-undefined', slug: 'c', reason: 'missing_redirect', references: [] },
    ]);
    expect(plan.deferredByReason).toEqual({ has_live_references: 0, missing_redirect: 2 });
  });

  it('prefers the live-reference deferral over a missing redirect', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      requireRedirect: true,
      candidates: [
        {
          id: 'live-and-no-redirect',
          liveReferences: [{ collection: 'signals', field: 'researchEntityId', count: 1 }],
          redirectPresent: false,
        },
      ],
    });
    expect(plan.eligible).toEqual([]);
    expect(plan.blocked[0]).toMatchObject({ reason: 'has_live_references' });
    expect(plan.deferredByReason).toEqual({ has_live_references: 1, missing_redirect: 0 });
  });

  it('does not require a redirect when requireRedirect is unset', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [{ id: 'a', liveReferences: [], redirectPresent: false }],
    });
    expect(plan.eligible).toEqual(['a']);
  });

  it('handles an empty candidate set', () => {
    expect(buildArchivedResearchEntityCleanupPlan({ candidates: [] })).toEqual({
      scanned: 0,
      eligibleCount: 0,
      blockedCount: 0,
      eligible: [],
      blocked: [],
      deferredByReason: { has_live_references: 0, missing_redirect: 0 },
    });
  });
});
