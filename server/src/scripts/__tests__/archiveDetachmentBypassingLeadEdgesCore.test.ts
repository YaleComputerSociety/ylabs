import { describe, expect, it } from 'vitest';
import { canonicalRoleForLegacy } from '../../models/canonicalRoleMapping';
import { PUBLIC_LEAD_ROLES } from '../../services/researchGroupService';
import {
  DETACHED_REVIEW_STATUS,
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
      twinPersonIds: ['person-twin'],
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
      twinPersonIds: ['person-twin'],
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
      twinPersonIds: ['person-twin'],
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
      twinPersonIds: ['person-twin'],
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
