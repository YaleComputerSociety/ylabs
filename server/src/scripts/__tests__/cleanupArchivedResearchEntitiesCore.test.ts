import { describe, expect, it } from 'vitest';
import { buildArchivedResearchEntityCleanupPlan } from '../cleanupArchivedResearchEntitiesCore';
import { DEPENDENT_DELETE_SPECS } from '../cleanupArchivedResearchEntities';

describe('buildArchivedResearchEntityCleanupPlan', () => {
  // No archived row is deletable (#3027). A row with a tombstone IS the canonical
  // mapping, and a row without one is the only surviving record of its slug, so both
  // arms block and eligibleCount is 0 by construction rather than by corpus accident.
  it('defers an archived row with no live references as the sole record of its slug', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', liveReferences: [] },
        {
          id: 'b',
          liveReferences: [{ collection: 'signals', field: 'researchEntityId', count: 0 }],
        },
      ],
    });
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 0, blockedCount: 2 });
    expect(plan.eligible).toEqual([]);
    expect(plan.deferredByReason).toEqual({
      has_live_references: 0,
      merged_shell_is_canonical_mapping: 0,
      retired_entity_type: 0,
      sole_surviving_record_of_slug: 2,
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
    expect(plan).toMatchObject({ scanned: 2, eligibleCount: 0, blockedCount: 2 });
    expect(plan.eligible).toEqual([]);
    // The live-reference arm still takes precedence, and still reports the references.
    expect(plan.blocked).toContainEqual({
      id: 'b',
      name: 'Blocked Home',
      slug: 'blocked-home',
      reason: 'has_live_references',
      references: [{ collection: 'posted_opportunities', field: 'researchEntityId', count: 3 }],
    });
    expect(plan.deferredByReason).toEqual({
      has_live_references: 1,
      merged_shell_is_canonical_mapping: 0,
      retired_entity_type: 0,
      sole_surviving_record_of_slug: 1,
    });
  });

  it('defers every merge-residue candidate when requireRedirect is set, redirect row or not', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      mergeResidueOnly: true,
      candidates: [
        { id: 'with-redirect', slug: 'a', liveReferences: [] },
        { id: 'no-redirect', slug: 'b', liveReferences: [] },
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
      sole_surviving_record_of_slug: 0,
    });
  });

  it('prefers the live-reference deferral over a missing redirect', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      mergeResidueOnly: true,
      candidates: [
        {
          id: 'live-and-no-redirect',
          liveReferences: [{ collection: 'signals', field: 'researchEntityId', count: 1 }],
        },
      ],
    });
    expect(plan.eligible).toEqual([]);
    expect(plan.blocked[0]).toMatchObject({ reason: 'has_live_references' });
    expect(plan.deferredByReason).toEqual({
      has_live_references: 1,
      merged_shell_is_canonical_mapping: 0,
      retired_entity_type: 0,
      sole_surviving_record_of_slug: 0,
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
        },
        {
          id: 'program-residue',
          slug: 'center-macmillan-example',
          entityType: 'PROGRAM',
          liveReferences: [],
        },
      ],
    });
    expect(plan.eligible).toEqual([]);
    // The retired-type arm still takes precedence over the sole-record arm, so the
    // reason an operator reads still names the retirement rather than the slug.
    expect(plan.blocked).toContainEqual({
      id: 'program-residue',
      slug: 'center-macmillan-example',
      reason: 'retired_entity_type',
      references: [],
    });
    expect(plan.deferredByReason.retired_entity_type).toBe(1);
    expect(plan.deferredByReason.sole_surviving_record_of_slug).toBe(1);
  });

  // Replaces an assertion that a missing redirect row was fine in default mode (#2795).
  // The redirect ledger is retired (#3027), so the arm now tests the condition the
  // redirect stood in for: with no tombstone, nothing routes the slug and the row is
  // the only record of what it was.
  it('fails closed on every candidate carrying no tombstone', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        { id: 'a', slug: 'a', liveReferences: [] },
        { id: 'b', slug: 'b', liveReferences: [] },
        { id: 'c', slug: 'c', liveReferences: [] },
      ],
    });
    expect(plan.eligible).toEqual([]);
    expect(plan.blocked).toEqual([
      { id: 'a', slug: 'a', reason: 'sole_surviving_record_of_slug', references: [] },
      { id: 'b', slug: 'b', reason: 'sole_surviving_record_of_slug', references: [] },
      { id: 'c', slug: 'c', reason: 'sole_surviving_record_of_slug', references: [] },
    ]);
    expect(plan.deferredByReason.sole_surviving_record_of_slug).toBe(3);
  });

  it('never deletes a tombstoned shell, because the shell IS the canonical mapping', () => {
    const plan = buildArchivedResearchEntityCleanupPlan({
      candidates: [
        {
          id: 'tombstoned',
          slug: 'faculty-research-area-example-lead',
          liveReferences: [],
          hasCanonicalTombstone: true,
        },
        {
          id: 'recorded',
          slug: 'faculty-research-area-recorded-lead',
          liveReferences: [],
          hasCanonicalTombstone: true,
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
        },
        {
          id: 'never-merged-unrecorded',
          slug: 'faculty-research-area-unrecorded-scholar',
          liveReferences: [],
          hasCanonicalTombstone: false,
        },
      ],
    });
    expect(plan.eligible).toEqual([]);
    expect(plan.deferredByReason.merged_shell_is_canonical_mapping).toBe(0);
    expect(plan.deferredByReason.sole_surviving_record_of_slug).toBe(2);
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
        sole_surviving_record_of_slug: 0,
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
