import { describe, expect, it } from 'vitest';
import {
  buildDepartmentLeadRepairApplyOperations,
  buildDepartmentLeadRepairPlan,
  compareDepartmentLeadRepairPlans,
} from '../departmentLeadRepairPlanCore';

const entity = {
  id: 'entity-1',
  slug: 'dept-physics-fixture',
  name: 'Fixture Lab',
};

describe('departmentLeadRepairPlanCore', () => {
  it('plans a PI membership from exact inferred PI user evidence', () => {
    const report = buildDepartmentLeadRepairPlan({
      entities: [entity],
      observations: [
        {
          entityId: 'entity-1',
          entityKey: 'dept-physics-fixture',
          field: 'inferredPiUserKey',
          value: 'netid:abc12',
          sourceName: 'dept-faculty-roster',
          sourceUrl: 'https://physics.yale.edu/people/fixture',
          confidence: 0.7,
        },
      ],
      users: [
        {
          id: 'user-1',
          netid: 'abc12',
          email: 'fixture@yale.edu',
          fname: 'Fixture',
          lname: 'Person',
        },
      ],
      existingMembers: [],
      generatedAt: '2026-05-26T00:00:00.000Z',
    });

    expect(report.rows).toEqual([
      expect.objectContaining({
        slug: 'dept-physics-fixture',
        status: 'planned',
        userId: 'user-1',
        netid: 'abc12',
        role: 'pi',
        sourceUrl: 'https://physics.yale.edu/people/fixture',
      }),
    ]);
    expect(report.summary).toMatchObject({ planned: 1, skippedExisting: 0, ambiguous: 0, noEvidence: 0 });
  });

  it('plans a PI membership when inferred PI evidence references a user observation key', () => {
    const report = buildDepartmentLeadRepairPlan({
      entities: [entity],
      observations: [
        {
          entityId: 'entity-1',
          entityKey: 'dept-physics-fixture',
          field: 'inferredPiUserKey',
          value: 'dept:physics:fixture-person',
          sourceName: 'dept-faculty-roster',
          sourceUrl: 'https://physics.yale.edu/people/faculty',
          confidence: 0.7,
        },
      ],
      users: [
        {
          id: 'user-1',
          netid: 'abc12',
          email: 'fixture@yale.edu',
          fname: 'Fixture',
          lname: 'Person',
          entityKeys: ['dept:physics:fixture-person'],
        },
      ],
      existingMembers: [],
      generatedAt: '2026-05-26T00:00:00.000Z',
    });

    expect(report.rows[0]).toMatchObject({
      status: 'planned',
      userId: 'user-1',
      evidenceKind: 'inferred_pi_user_key',
    });
  });

  it('uses Faculty PI contact evidence when no inferred PI key exists', () => {
    const report = buildDepartmentLeadRepairPlan({
      entities: [entity],
      observations: [
        {
          entityId: 'entity-1',
          entityKey: 'dept-physics-fixture',
          field: 'contactRole',
          value: 'Faculty PI',
          sourceName: 'department-undergrad-research',
          sourceUrl: 'https://physics.yale.edu/undergraduate/research',
        },
        {
          entityId: 'entity-1',
          entityKey: 'dept-physics-fixture',
          field: 'contactEmail',
          value: 'fixture@yale.edu',
          sourceName: 'department-undergrad-research',
          sourceUrl: 'https://physics.yale.edu/undergraduate/research',
        },
      ],
      users: [
        {
          id: 'user-1',
          netid: 'abc12',
          email: 'fixture@yale.edu',
          fname: 'Fixture',
          lname: 'Person',
        },
      ],
      existingMembers: [],
      generatedAt: '2026-05-26T00:00:00.000Z',
    });

    expect(report.rows[0]).toMatchObject({
      status: 'planned',
      userId: 'user-1',
      evidenceKind: 'faculty_pi_contact',
    });
  });

  it('skips entities that already have a current PI member', () => {
    const report = buildDepartmentLeadRepairPlan({
      entities: [entity],
      observations: [],
      users: [],
      existingMembers: [{ researchEntityId: 'entity-1', userId: 'user-1', role: 'pi', isCurrentMember: true }],
      generatedAt: '2026-05-26T00:00:00.000Z',
    });

    expect(report.rows[0]).toMatchObject({
      status: 'skipped_existing',
      existingMemberUserId: 'user-1',
    });
    expect(report.summary).toMatchObject({ planned: 0, skippedExisting: 1 });
  });

  it('builds idempotent PI membership upserts only for planned rows', () => {
    const report = buildDepartmentLeadRepairPlan({
      entities: [entity],
      observations: [
        {
          entityId: 'entity-1',
          entityKey: 'dept-physics-fixture',
          field: 'inferredPiUserKey',
          value: 'netid:abc12',
          sourceName: 'dept-faculty-roster',
          sourceUrl: 'https://physics.yale.edu/people/fixture',
          confidence: 0.7,
        },
      ],
      users: [
        {
          id: 'user-1',
          netid: 'abc12',
          email: 'fixture@yale.edu',
          fname: 'Fixture',
          lname: 'Person',
        },
      ],
      existingMembers: [
        { researchEntityId: 'entity-2', userId: 'user-2', role: 'pi', isCurrentMember: true },
      ],
      generatedAt: '2026-05-26T00:00:00.000Z',
    });

    const ops = buildDepartmentLeadRepairApplyOperations(report, {
      now: new Date('2026-05-27T00:00:00.000Z'),
    });

    expect(ops).toEqual([
      {
        updateOne: {
          filter: {
            researchEntityId: 'entity-1',
            userId: 'user-1',
            role: 'pi',
          },
          update: {
            $set: expect.objectContaining({
              researchEntityId: 'entity-1',
              userId: 'user-1',
              role: 'pi',
              isCurrentMember: true,
              name: 'Fixture Person',
              email: 'fixture@yale.edu',
              confidence: 0.7,
              sourceUrl: 'https://physics.yale.edu/people/fixture',
              'fieldProvenance.role.sourceName': 'dept-faculty-roster',
            }),
            $setOnInsert: {
              joinedAt: new Date('2026-05-27T00:00:00.000Z'),
            },
          },
          upsert: true,
        },
      },
    ]);
  });

  it('compares live and reviewed plans before an apply is allowed', () => {
    const expected = buildDepartmentLeadRepairPlan({
      entities: [entity],
      observations: [
        {
          entityId: 'entity-1',
          entityKey: 'dept-physics-fixture',
          field: 'inferredPiUserKey',
          value: 'netid:abc12',
          sourceName: 'dept-faculty-roster',
          sourceUrl: 'https://physics.yale.edu/people/fixture',
          confidence: 0.7,
        },
      ],
      users: [
        {
          id: 'user-1',
          netid: 'abc12',
          email: 'fixture@yale.edu',
          fname: 'Fixture',
          lname: 'Person',
        },
      ],
      existingMembers: [],
    });
    const changed = {
      ...expected,
      rows: expected.rows.map((row) => ({ ...row, userId: 'different-user' })),
    };

    expect(compareDepartmentLeadRepairPlans(expected, expected)).toEqual({
      matches: true,
      reasons: [],
    });
    expect(compareDepartmentLeadRepairPlans(changed, expected)).toEqual({
      matches: false,
      reasons: ['planned row set changed'],
    });
  });
});
