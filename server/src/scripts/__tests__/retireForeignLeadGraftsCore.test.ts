import { describe, expect, it } from 'vitest';
import type { ResearchEntityRosterEntry } from '../../services/researchEntityMembershipAccessor';
import {
  buildGateLeadRow,
  planForeignLeadGraftRetirement,
  selectForeignLeadGrafts,
  summarizeForeignLeadGraftRetirement,
} from '../retireForeignLeadGraftsCore';

const rosterEntry = (
  overrides: Partial<ResearchEntityRosterEntry>,
): ResearchEntityRosterEntry =>
  ({
    researchEntityId: undefined as any,
    personId: 'p1' as any,
    roleAssignmentId: 'ra1' as any,
    name: 'Wenjun Hu',
    netid: '',
    email: '',
    role: 'pi',
    roleCanonical: 'PI' as any,
    state: 'UNKNOWN',
    isCurrentMember: false,
    confidence: 0,
    reviewStatus: 'UNREVIEWED',
    profileLinks: [],
    ...overrides,
  }) as ResearchEntityRosterEntry;

const weiHuEntity = {
  _id: 'e1',
  slug: 'hu-wh288',
  name: 'Wei Hu Lab',
  entityType: 'INDIVIDUAL_RESEARCH',
  sourceUrls: [
    'https://medicine.yale.edu/profile/wei-hu-wh447/',
    'https://www.weihulab.org/',
    'https://orcid.org/0000-0002-0392-6939',
  ],
};

describe('buildGateLeadRow', () => {
  it('splits the display name into fname/lname and carries review metadata', () => {
    const row = buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu' }));
    expect(row.user.fname).toBe('Wenjun');
    expect(row.user.lname).toBe('Hu');
    expect(row.reviewStatus).toBe('UNREVIEWED');
    expect(row.roleAssignmentId).toBe('ra1');
  });
});

describe('selectForeignLeadGrafts', () => {
  it('selects a same-surname foreign lead that does not corroborate the profile home', () => {
    const leadRows = [buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu', roleAssignmentId: 'ra1' as any }))];
    const grafts = selectForeignLeadGrafts({ entity: weiHuEntity, leadRows });
    expect(grafts).toHaveLength(1);
    expect(grafts[0].roleAssignmentId).toBe('ra1');
  });

  it('never selects an operator-APPROVED lead even when it is foreign', () => {
    const leadRows = [
      buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu', reviewStatus: 'APPROVED' })),
    ];
    expect(selectForeignLeadGrafts({ entity: weiHuEntity, leadRows })).toHaveLength(0);
  });

  it('does not select when a corroborating lead makes the entity uncontested', () => {
    const leadRows = [
      buildGateLeadRow(
        rosterEntry({
          name: 'Wei Hu',
          roleAssignmentId: 'ra-correct' as any,
          personId: 'p-correct' as any,
          websiteUrl: 'https://medicine.yale.edu/profile/wei-hu-wh447/',
          profileLinks: [
            { kind: 'YALE_OFFICIAL', url: 'https://medicine.yale.edu/profile/wei-hu-wh447/' } as any,
          ],
        }),
      ),
      buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu', roleAssignmentId: 'ra1' as any })),
    ];
    expect(selectForeignLeadGrafts({ entity: weiHuEntity, leadRows })).toHaveLength(0);
  });

  it('fails closed for organizational entities with no personal identity', () => {
    const center = { ...weiHuEntity, entityType: 'CENTER' };
    const leadRows = [buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu' }))];
    expect(selectForeignLeadGrafts({ entity: center, leadRows })).toHaveLength(0);
  });

  it('ignores HISTORICAL and non-lead roles', () => {
    const historical = [buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu', state: 'HISTORICAL' }))];
    expect(selectForeignLeadGrafts({ entity: weiHuEntity, leadRows: historical })).toHaveLength(0);
    const member = [buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu', role: 'member' }))];
    expect(selectForeignLeadGrafts({ entity: weiHuEntity, leadRows: member })).toHaveLength(0);
  });
});

describe('planForeignLeadGraftRetirement', () => {
  it('plans retirement and reports zero remaining gate leads for a sole foreign lead', () => {
    const leadRows = [buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu' }))];
    const plan = planForeignLeadGraftRetirement({ entity: weiHuEntity, leadRows });
    expect(plan).not.toBeNull();
    expect(plan?.roleAssignmentIds).toEqual(['ra1']);
    expect(plan?.graftedLeadNames).toEqual(['Wenjun Hu']);
    expect(plan?.remainingGateLeadCount).toBe(0);
  });

  it('returns null when nothing qualifies', () => {
    const center = { ...weiHuEntity, entityType: 'CENTER' };
    const leadRows = [buildGateLeadRow(rosterEntry({ name: 'Wenjun Hu' }))];
    expect(planForeignLeadGraftRetirement({ entity: center, leadRows })).toBeNull();
  });
});

describe('summarizeForeignLeadGraftRetirement', () => {
  it('aggregates retired assignments and orphaned entities', () => {
    const summary = summarizeForeignLeadGraftRetirement([
      { entityId: 'a', roleAssignmentIds: ['x', 'y'], personIds: ['p'], graftedLeadNames: ['A'], remainingGateLeadCount: 0 } as any,
      null,
      { entityId: 'b', roleAssignmentIds: ['z'], personIds: ['q'], graftedLeadNames: ['B'], remainingGateLeadCount: 1 } as any,
    ]);
    expect(summary).toEqual({
      entitiesScanned: 3,
      entitiesChanged: 2,
      roleAssignmentsRetired: 3,
      entitiesLeftWithoutGateLead: 1,
    });
  });
});
