import { describe, expect, it } from 'vitest';
import { buildArchivedResearchEntityCleanupPlan } from '../cleanupArchivedResearchEntitiesCore';
import { DEPENDENT_DELETE_SPECS } from '../cleanupArchivedResearchEntities';

describe('buildArchivedResearchEntityCleanupPlan', () => {
  it('marks archived entities with no live references as eligible', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [] },
        {
          id: 'b',
          liveReferences: [{ collection: 'signals', field: 'researchEntityId', count: 0 }],
        },
      ],
    });
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 2, blockedCount: 0 });
    expect(plan.eligible).toEqual(['a', 'b']);
    expect(plan.blocked).toEqual([]);
    expect(plan.deferredByReason).toEqual({
      has_live_references: 0,
      missing_redirect: 0,
      retired_entity_type: 0,
    });
  });

  it('fails closed by blocking entities that still have a live reference', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [] },
        {
          id: 'b',
          name: 'Blocked Home',
          slug: 'blocked-home',
          liveReferences: [
            { collection: 'posted_opportunities', field: 'researchEntityId', count: 3 },
          ],
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
    expect(plan.deferredByReason).toEqual({
      has_live_references: 1,
      missing_redirect: 0,
      retired_entity_type: 0,
    });
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
    expect(plan.deferredByReason).toEqual({
      has_live_references: 0,
      missing_redirect: 2,
      retired_entity_type: 0,
    });
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
    expect(plan.deferredByReason).toEqual({
      has_live_references: 1,
      missing_redirect: 0,
      retired_entity_type: 0,
    });
  });

  it('defers retirement residue carrying an entityType retired from the product model', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'live-lab', slug: 'lab-a', entityType: 'LAB', liveReferences: [] },
        {
          id: 'program-residue',
          slug: 'center-macmillan-example',
          entityType: 'PROGRAM',
          liveReferences: [],
        },
      ],
    });
    expect(plan.eligible).toEqual(['live-lab']);
    expect(plan.blocked).toEqual([
      {
        id: 'program-residue',
        slug: 'center-macmillan-example',
        reason: 'retired_entity_type',
        references: [],
      },
    ]);
    expect(plan.deferredByReason.retired_entity_type).toBe(1);
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
      deferredByReason: { has_live_references: 0, missing_redirect: 0, retired_entity_type: 0 },
    });
  });
});

describe('dependent artifact cascade specs', () => {
  it('keys role assignments on the polymorphic target, not researchEntityId', () => {
    const roleSpecs = DEPENDENT_DELETE_SPECS.filter(
      (spec) => spec.collection === 'role_assignments',
    );

    expect(roleSpecs).toHaveLength(1);
    expect(roleSpecs[0].field).toBe('target.id');
    expect(roleSpecs[0].extraFilter).toEqual({ 'target.kind': 'RESEARCH_ENTITY' });
    expect(roleSpecs[0].field).not.toBe('researchEntityId');
  });

  it('cascades both sides of a research entity relationship', () => {
    const fields = DEPENDENT_DELETE_SPECS.filter(
      (spec) => spec.collection === 'research_entity_relationships',
    ).map((spec) => spec.field);

    expect(fields).toEqual(
      expect.arrayContaining(['sourceResearchEntityId', 'targetResearchEntityId']),
    );
  });

  it('never cascades redirects, saved plans, or append-only observations', () => {
    const collections = DEPENDENT_DELETE_SPECS.map((spec) => spec.collection);

    expect(collections).not.toContain('research_entity_redirects');
    expect(collections).not.toContain('research_plans');
    expect(collections).not.toContain('observations');
  });

  it('does not list collections that no longer exist', () => {
    const collections = DEPENDENT_DELETE_SPECS.map((spec) => spec.collection);

    expect(collections).not.toContain('research_entity_members');
    expect(collections).not.toContain('research_scholarly_links');
  });
});
