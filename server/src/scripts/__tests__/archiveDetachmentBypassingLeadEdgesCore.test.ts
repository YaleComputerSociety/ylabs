import { describe, expect, it } from 'vitest';
import { canonicalRoleForLegacy } from '../../models/canonicalRoleMapping';
import { PUBLIC_LEAD_ROLES } from '../../services/researchGroupService';
import {
  classifyPastBypassArchive,
  DETACHED_REVIEW_STATUS,
  identitiesNameDistinctHumans,
  planDetachmentBypassRepair,
  type LeadEdgeLike,
} from '../archiveDetachmentBypassingLeadEdgesCore';

const edge = (
  over: Partial<LeadEdgeLike> & { edgeId: string; personId: string },
): LeadEdgeLike => ({
  entityId: 'entity-1',
  role: 'PI',
  archived: false,
  reviewStatus: 'UNREVIEWED',
  ...over,
});

const detached = {
  edgeId: 'detached-edge',
  personId: 'person-detached',
  entityId: 'entity-1',
  role: 'PI',
};

describe('planDetachmentBypassRepair', () => {
  it('archives the twin edge and reports no surviving lead when there is none', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: [
        edge({ edgeId: 'twin-edge', personId: 'person-twin' }),
        edge({
          edgeId: 'detached-edge',
          personId: 'person-detached',
          archived: true,
          reviewStatus: DETACHED_REVIEW_STATUS,
        }),
      ],
    });
    expect(plan.verdict).toBe('archive_bypassing_edge');
    expect(plan.bypassingEdgeIds).toEqual(['twin-edge']);
    expect(plan.survivingLeadEdgeIds).toEqual([]);
  });

  it('reports a surviving lead held by somebody else, so the row is not held', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: [
        edge({ edgeId: 'twin-edge', personId: 'person-twin' }),
        edge({ edgeId: 'real-lead', personId: 'person-other' }),
      ],
    });
    expect(plan.bypassingEdgeIds).toEqual(['twin-edge']);
    expect(plan.survivingLeadEdgeIds).toEqual(['real-lead']);
  });

  it('never counts the detached person or a twin as a surviving lead', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: [
        edge({ edgeId: 'twin-edge', personId: 'person-twin' }),
        edge({ edgeId: 'twin-other-role', personId: 'person-twin', role: 'CO_PI' }),
        edge({ edgeId: 'detached-live-elsewhere', personId: 'person-detached', role: 'DIRECTOR' }),
      ],
    });
    expect(plan.survivingLeadEdgeIds).toEqual([]);
  });

  it('only treats a same-role live twin edge as bypassing', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: [
        edge({ edgeId: 'twin-other-role', personId: 'person-twin', role: 'CO_PI' }),
        edge({
          edgeId: 'twin-already-archived',
          personId: 'person-twin',
          archived: true,
        }),
        edge({
          edgeId: 'twin-already-detached',
          personId: 'person-twin',
          reviewStatus: DETACHED_REVIEW_STATUS,
        }),
      ],
    });
    expect(plan.verdict).toBe('keep_no_bypass');
    expect(plan.bypassingEdgeIds).toEqual([]);
  });
});

describe('a detachment is scoped to its own row and its own human (#5854)', () => {
  const detachedIdentity = {
    personId: 'person-detached',
    netid: 'ab111',
    email: 'first.namesake@example.edu',
  };
  const namesakeIdentity = {
    personId: 'person-namesake',
    netid: 'cd222',
    email: 'second.namesake@example.edu',
  };

  it('archives only the twin edge on the detachment row and leaves the twin edge on its own row', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: [
        edge({ edgeId: 'twin-edge-on-detachment-row', personId: 'person-twin' }),
        edge({
          edgeId: 'twin-edge-on-own-row',
          personId: 'person-twin',
          entityId: 'entity-own-row',
        }),
      ],
    });
    expect(plan.verdict).toBe('archive_bypassing_edge');
    expect(plan.bypassingEdgeIds).toEqual(['twin-edge-on-detachment-row']);
  });

  it('keeps the only edge when it sits on a row other than the detachment row', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: [
        edge({
          edgeId: 'twin-edge-on-own-row',
          personId: 'person-twin',
          entityId: 'entity-own-row',
        }),
      ],
    });
    expect(plan.verdict).toBe('keep_no_bypass');
    expect(plan.bypassingEdgeIds).toEqual([]);
  });

  it('never archives the lead edge of a same-name record whose identifiers name a different human', () => {
    const plan = planDetachmentBypassRepair({
      detached,
      detachedIdentity,
      twinCandidates: [namesakeIdentity],
      entityLeadEdges: [
        edge({ edgeId: 'correct-lead-edge', personId: 'person-namesake' }),
        edge({
          edgeId: 'detached-edge',
          personId: 'person-detached',
          archived: true,
          reviewStatus: DETACHED_REVIEW_STATUS,
        }),
      ],
    });
    expect(plan.verdict).toBe('keep_no_bypass');
    expect(plan.bypassingEdgeIds).toEqual([]);
    expect(plan.survivingLeadEdgeIds).toEqual(['correct-lead-edge']);
  });

  it('plans nothing on a second run once the bypassing edge is archived', () => {
    const entityLeadEdges = [
      edge({ edgeId: 'twin-edge', personId: 'person-twin' }),
      edge({ edgeId: 'twin-edge-on-own-row', personId: 'person-twin', entityId: 'entity-own-row' }),
    ];
    const first = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges,
    });
    const archivedIds = new Set(first.bypassingEdgeIds);
    const afterFirstRun = entityLeadEdges.map((leadEdge) =>
      archivedIds.has(leadEdge.edgeId)
        ? { ...leadEdge, archived: true, reviewStatus: DETACHED_REVIEW_STATUS }
        : leadEdge,
    );
    const second = planDetachmentBypassRepair({
      detached,
      twinCandidates: [{ personId: 'person-twin' }],
      entityLeadEdges: afterFirstRun,
    });
    expect(first.bypassingEdgeIds).toEqual(['twin-edge']);
    expect(second.verdict).toBe('keep_no_bypass');
    expect(second.bypassingEdgeIds).toEqual([]);
    expect(afterFirstRun.find((e) => e.edgeId === 'twin-edge-on-own-row')?.archived).toBe(false);
  });

  it('treats differing netids as one human when one is an alias of the other email', () => {
    expect(
      identitiesNameDistinctHumans(
        { personId: 'a', netid: 'ab111', email: 'ab111@example.edu' },
        { personId: 'b', netid: 'first.namesake', email: 'first.namesake@example.edu' },
      ),
    ).toBe(true);
    expect(
      identitiesNameDistinctHumans(
        { personId: 'a', netid: 'ab111', email: 'first.namesake@example.edu' },
        { personId: 'b', netid: 'first.namesake', email: 'ab111@example.edu' },
      ),
    ).toBe(false);
    expect(
      identitiesNameDistinctHumans(
        { personId: 'a', netid: 'ab111' },
        { personId: 'b', netid: 'cd222' },
      ),
    ).toBe(false);
  });

  it('treats an ORCID conflict or an operator distinct-person record as two humans', () => {
    expect(
      identitiesNameDistinctHumans(
        { personId: 'a', orcid: '0000-0000-0000-0001' },
        { personId: 'b', orcid: '0000-0000-0000-0002' },
      ),
    ).toBe(true);
    expect(
      identitiesNameDistinctHumans(
        { personId: 'a' },
        { personId: 'b', distinctFromPersonIds: ['a'] },
      ),
    ).toBe(true);
    expect(identitiesNameDistinctHumans({ personId: 'a' }, { personId: 'b' })).toBe(false);
  });

  it('counts a past archive that took a distinct human or sat on a row with no detachment', () => {
    const archivedEdge = edge({
      edgeId: 'past-archive',
      personId: 'person-namesake',
      archived: true,
      reviewStatus: DETACHED_REVIEW_STATUS,
    });
    const detachment = { ...detached, identity: detachedIdentity };
    expect(
      classifyPastBypassArchive({
        archivedEdge,
        archivedIdentity: namesakeIdentity,
        detachments: [detachment],
      }),
    ).toBe('archived_a_distinct_human');
    expect(
      classifyPastBypassArchive({
        archivedEdge: { ...archivedEdge, entityId: 'entity-own-row' },
        archivedIdentity: namesakeIdentity,
        detachments: [detachment],
      }),
    ).toBe('no_detachment_on_its_entity');
    expect(
      classifyPastBypassArchive({
        archivedEdge,
        archivedIdentity: { personId: 'person-namesake' },
        detachments: [detachment],
      }),
    ).toBe('consistent_with_a_detachment');
  });
});

/**
 * The trap that made an earlier pass read 0 surviving leads on both rows: stored
 * edges carry canonical roles while the served-member comparison set carries the
 * legacy labels, so filtering `role_assignments` by `PUBLIC_LEAD_ROLES` matches
 * nothing. Pinned here so the two vocabularies cannot silently converge again.
 */
describe('lead role vocabularies are distinct', () => {
  it('stores canonical roles that the legacy served-member set does not contain', () => {
    const canonical = Array.from(PUBLIC_LEAD_ROLES).flatMap((legacy) => {
      const mapped = canonicalRoleForLegacy(legacy);
      return mapped ? [mapped] : [];
    });
    expect(canonical).toEqual(['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR']);
    for (const role of canonical) {
      expect(PUBLIC_LEAD_ROLES.has(role)).toBe(false);
    }
  });
});
