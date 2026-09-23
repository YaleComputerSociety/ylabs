import { describe, expect, it } from 'vitest';
import {
  entityIdsLeftWithNoEdge,
  planUnevidencedMemberEdgeRetirements,
  type UnevidencedMemberEdgeEntityInput,
  type UnevidencedMemberEdgeInput,
} from '../retireUnevidencedMemberEdgesCore';
import { parseRetireUnevidencedMemberEdgeArgs } from '../retireUnevidencedMemberEdges';

const lab: UnevidencedMemberEdgeEntityInput = {
  id: 'entity-lab',
  slug: 'a-person-scoped-row',
  entityType: 'FACULTY_RESEARCH_AREA',
  served: true,
};

const edge = (over: Partial<UnevidencedMemberEdgeInput> = {}): UnevidencedMemberEdgeInput => ({
  id: 'edge-1',
  entityId: 'entity-lab',
  role: 'GRADUATE_STUDENT',
  hasRosterProvenance: false,
  archived: false,
  ...over,
});

describe('planUnevidencedMemberEdgeRetirements', () => {
  it('retires a non-lead edge citing nothing on a served person-scoped row', () => {
    const plan = planUnevidencedMemberEdgeRetirements(
      [edge(), edge({ id: 'edge-lead', role: 'PI' })],
      [lab],
    );

    expect(plan.retire.map((row) => row.id)).toEqual(['edge-1']);
    expect(plan.retire[0].slug).toBe('a-person-scoped-row');
    expect(plan.skipped.leadRole).toBe(1);
  });

  it('keeps an edge that cites a roster page', () => {
    const plan = planUnevidencedMemberEdgeRetirements([edge({ hasRosterProvenance: true })], [lab]);

    expect(plan.retire).toEqual([]);
    expect(plan.skipped.hasProvenance).toBe(1);
  });

  /**
   * The out-of-scope cohort. An unattributed `CORE_FACULTY` edge on a centre is an
   * attribution gap on a body that genuinely has hundreds of affiliated faculty,
   * and folding it in turns a 53-edge repair into a 1,019-edge one.
   */
  it('leaves an organization-scoped edge alone', () => {
    const plan = planUnevidencedMemberEdgeRetirements(
      [edge({ role: 'CORE_FACULTY', entityId: 'entity-center' })],
      [{ id: 'entity-center', slug: 'a-center', entityType: 'CENTER', served: true }],
    );

    expect(plan.retire).toEqual([]);
    expect(plan.skipped.notPersonScoped).toBe(1);
  });

  it('leaves an unserved row and an already-archived edge alone', () => {
    const unserved = planUnevidencedMemberEdgeRetirements([edge()], [{ ...lab, served: false }]);
    expect(unserved.retire).toEqual([]);
    expect(unserved.skipped.notServed).toBe(1);

    const archived = planUnevidencedMemberEdgeRetirements([edge({ archived: true })], [lab]);
    expect(archived.retire).toEqual([]);
    expect(archived.skipped.alreadyArchived).toBe(1);
  });

  it('reports what each touched row keeps, so a lead-only row is visible as such', () => {
    const plan = planUnevidencedMemberEdgeRetirements(
      [edge({ id: 'student-a' }), edge({ id: 'student-b' }), edge({ id: 'the-lead', role: 'PI' })],
      [lab],
    );

    expect(plan.retire).toHaveLength(2);
    expect(plan.remainingByEntityId['entity-lab']).toBe(1);
    expect(entityIdsLeftWithNoEdge(plan)).toEqual([]);
  });

  /**
   * A row that would keep nothing is a finding, not a step: a served page
   * asserting nobody is a worse surface than the claim being repaired, and the
   * driver refuses to apply when this list is non-empty.
   */
  it('names a row that the plan would leave with no edge at all', () => {
    const plan = planUnevidencedMemberEdgeRetirements(
      [edge({ id: 'only-edge', role: 'STAFF' })],
      [lab],
    );

    expect(plan.retire).toHaveLength(1);
    expect(plan.remainingByEntityId['entity-lab']).toBe(0);
    expect(entityIdsLeftWithNoEdge(plan)).toEqual(['entity-lab']);
  });
});

describe('parseRetireUnevidencedMemberEdgeArgs', () => {
  it('is dry-run by default and needs the confirm flag spelled out', () => {
    expect(parseRetireUnevidencedMemberEdgeArgs([])).toMatchObject({
      dryRun: true,
      confirmed: false,
    });
    expect(parseRetireUnevidencedMemberEdgeArgs(['--apply'])).toMatchObject({
      dryRun: false,
      confirmed: false,
    });
    expect(
      parseRetireUnevidencedMemberEdgeArgs([
        '--apply',
        '--confirm-retire-unevidenced-member-edges',
      ]),
    ).toMatchObject({ dryRun: false, confirmed: true });
  });

  it('refuses an argument it does not recognize', () => {
    expect(() => parseRetireUnevidencedMemberEdgeArgs(['--force'])).toThrow(/Unknown/);
  });
});
