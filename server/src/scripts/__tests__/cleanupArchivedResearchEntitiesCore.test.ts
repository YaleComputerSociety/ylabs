import { describe, expect, it } from 'vitest';
import { buildArchivedResearchEntityCleanupPlan } from '../cleanupArchivedResearchEntitiesCore';
import { DEPENDENT_DELETE_SPECS } from '../cleanupArchivedResearchEntities';

describe('buildArchivedResearchEntityCleanupPlan', () => {
  it('marks archived entities with no live references as eligible', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [], redirectPresent: true },
        {
          id: 'b',
          liveReferences: [{ collection: 'signals', field: 'researchEntityId', count: 0 }],
          redirectPresent: true,
        },
      ],
    });
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 2, blockedCount: 0 });
    expect(plan.eligible).toEqual(['a', 'b']);
    expect(plan.blocked).toEqual([]);
    expect(plan.deferredByReason).toEqual({
      has_live_references: 0,
      merged_shell_is_canonical_mapping: 0,
      retired_entity_type: 0,
      no_surviving_redirect: 0,
    });
  });

  it('fails closed by blocking entities that still have a live reference', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [], redirectPresent: true },
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
      merged_shell_is_canonical_mapping: 0,
      retired_entity_type: 0,
      no_surviving_redirect: 0,
    });
  });

  it('defers every merge-residue candidate when requireRedirect is set, redirect row or not', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      requireRedirect: true,
      candidates: [
        { id: 'with-redirect', slug: 'a', liveReferences: [], redirectPresent: true },
        { id: 'no-redirect', slug: 'b', liveReferences: [], redirectPresent: false },
        { id: 'redirect-undefined', slug: 'c', liveReferences: [] },
      ],
    });
    expect(plan.eligible).toEqual([]);
    expect(plan.blocked).toEqual([
      {
        id: 'with-redirect',
        slug: 'a',
        reason: 'merged_shell_is_canonical_mapping',
        references: [],
      },
      { id: 'no-redirect', slug: 'b', reason: 'merged_shell_is_canonical_mapping', references: [] },
      {
        id: 'redirect-undefined',
        slug: 'c',
        reason: 'merged_shell_is_canonical_mapping',
        references: [],
      },
    ]);
    expect(plan.deferredByReason).toEqual({
      has_live_references: 0,
      merged_shell_is_canonical_mapping: 3,
      retired_entity_type: 0,
      no_surviving_redirect: 0,
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
      merged_shell_is_canonical_mapping: 0,
      retired_entity_type: 0,
      no_surviving_redirect: 0,
    });
  });

  it('defers retirement residue carrying an entityType retired from the product model', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        {
          id: 'live-lab',
          slug: 'lab-a',
          entityType: 'LAB',
          liveReferences: [],
          redirectPresent: true,
        },
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

  // Replaces an assertion that a missing redirect row was fine in default mode (#2795). The
  // deletion is only safe while something else can still answer the slug, so default mode now
  // demands the same surviving record `--merge-residue-only` demanded.
  it('fails closed on a candidate whose slug has no surviving redirect row', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'explicitly-absent', slug: 'a', liveReferences: [], redirectPresent: false },
        { id: 'never-measured', slug: 'b', liveReferences: [] },
        { id: 'recorded', slug: 'c', liveReferences: [], redirectPresent: true },
      ],
    });
    expect(plan.eligible).toEqual(['recorded']);
    expect(plan.blocked).toEqual([
      { id: 'explicitly-absent', slug: 'a', reason: 'no_surviving_redirect', references: [] },
      { id: 'never-measured', slug: 'b', reason: 'no_surviving_redirect', references: [] },
    ]);
    expect(plan.deferredByReason.no_surviving_redirect).toBe(2);
  });

  it('never deletes a tombstoned shell, because the shell IS the canonical mapping', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        {
          id: 'tombstoned',
          slug: 'faculty-research-area-example-lead',
          liveReferences: [],
          hasCanonicalTombstone: true,
          redirectPresent: false,
        },
        {
          id: 'recorded',
          slug: 'faculty-research-area-recorded-lead',
          liveReferences: [],
          hasCanonicalTombstone: true,
          redirectPresent: true,
        },
      ],
    });
    expect(plan.eligible).toEqual([]);
    expect(plan.deferredByReason.merged_shell_is_canonical_mapping).toBe(2);
  });

  it('does not charge a never-merged row to the canonical-mapping reason', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        {
          id: 'never-merged-recorded',
          slug: 'faculty-research-area-departed-scholar',
          liveReferences: [],
          hasCanonicalTombstone: false,
          redirectPresent: true,
        },
        {
          id: 'never-merged-unrecorded',
          slug: 'faculty-research-area-unrecorded-scholar',
          liveReferences: [],
          hasCanonicalTombstone: false,
        },
      ],
    });
    expect(plan.eligible).toEqual(['never-merged-recorded']);
    expect(plan.deferredByReason.merged_shell_is_canonical_mapping).toBe(0);
    expect(plan.deferredByReason.no_surviving_redirect).toBe(1);
  });

  it('handles an empty candidate set', () => {
    expect(buildArchivedResearchEntityCleanupPlan({ candidates: [] })).toEqual({
      scanned: 0,
      eligibleCount: 0,
      blockedCount: 0,
      eligible: [],
      blocked: [],
      deferredByReason: {
        has_live_references: 0,
        merged_shell_is_canonical_mapping: 0,
        retired_entity_type: 0,
        no_surviving_redirect: 0,
      },
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
