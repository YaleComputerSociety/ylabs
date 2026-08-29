import { describe, expect, it } from 'vitest';

import {
  RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS,
  missingPublicDescriptionGateFields,
  researchEntityServesPublicDetail,
  withPublicDescriptionGateFields,
} from '../researchEntityPublicDescription';
import { buildPublicDescriptionAuditReport } from '../researchEntityPublicDescriptionAuditService';
import { PUBLIC_RELATED_ENTITY_PROJECTION } from '../researchGroupService';
import { savedResearchEntityProjection } from '../researchPlanService';

const HISTORICAL_AUDIT_PROJECTION =
  '_id slug name displayName kind entityType website websiteUrl sourceUrls shortDescription fullDescription profileSynthesisDescription descriptionSource';

const HISTORICAL_SAVED_PROJECTION =
  '_id slug name displayName kind entityType departments school shortDescription fullDescription profileSynthesisDescription sourceUrls website websiteUrl undergraduateCurrentAvailability hasUndergradHostingEvidence';

const HISTORICAL_RELATED_PROJECTION =
  '_id slug name displayName kind entityType departments shortDescription fullDescription studentVisibilityTier descriptionSource sourceUrls website websiteUrl';

/**
 * Servable only via `researchAreas`: the stored card is third-person bio voice
 * that serve-time hygiene strips, so the card the student sees is derived from
 * the entity's own research-area chips. Drop `researchAreas` and the gate has
 * nothing left to build a card from, so the entity fails closed.
 */
const chipCardEntity = {
  _id: 'entity-chip-card',
  slug: 'chip-card-lab',
  name: 'Capillary Barrier Lab',
  kind: 'lab',
  entityType: 'LAB',
  shortDescription:
    'Finally, I am passionate about my research, where I investigate capillary barrier failure and its consequences in critically ill newborns, with a keen focus on permeability changes.',
  fullDescription:
    'Our passion is to understand capillary barrier failure in the setting of critical illness. Capillary walls, and the endothelial cells that line them, sit within microns of nearly every cell in the body. These vessels regulate blood volume, flow and fluidity as well as immune and platelet activation. To understand how these processes break down during critical illness we must understand the fundamental biology of endothelial cells.',
  researchAreas: [
    'Capillary Barrier Failure',
    'Critical Illness',
    'Endothelial Cells',
    'Immune Activation',
  ],
  sourceUrls: ['https://example.yale.edu/research/chip-card-lab'],
};

const plainEntity = {
  _id: 'entity-plain',
  slug: 'plain-research',
  name: 'Plain Research',
  kind: 'lab',
  entityType: 'LAB',
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
  researchAreas: ['Molecular Dynamics'],
  sourceUrls: ['https://example.yale.edu/research/plain'],
};

const applyProjection = <T extends Record<string, any>>(entity: T, projection: string): T => {
  const projected = new Set(projection.split(/\s+/).filter(Boolean));
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => projected.has(key)),
  ) as T;
};

const auditOver = (entities: Array<Record<string, any>>) =>
  buildPublicDescriptionAuditReport({ entities, leadMembersByEntityId: new Map() });

describe('public description gate projection completeness', () => {
  const fixtures = [plainEntity, chipCardEntity];

  it('reports researchAreas as read-but-unprojected for the projection that inflated the audit', () => {
    expect(missingPublicDescriptionGateFields(HISTORICAL_AUDIT_PROJECTION)).toEqual([
      'researchAreas',
    ]);
  });

  it('reports every gate field the two historical request-path projections dropped', () => {
    expect(missingPublicDescriptionGateFields(HISTORICAL_SAVED_PROJECTION)).toEqual([
      'descriptionSource',
      'researchAreas',
    ]);
    expect(missingPublicDescriptionGateFields(HISTORICAL_RELATED_PROJECTION)).toEqual([
      'profileSynthesisDescription',
      'researchAreas',
    ]);
  });

  it('keeps every live serve-path projection complete with respect to the gate', () => {
    expect(missingPublicDescriptionGateFields(savedResearchEntityProjection)).toEqual([]);
    expect(missingPublicDescriptionGateFields(PUBLIC_RELATED_ENTITY_PROJECTION)).toEqual([]);
  });

  it('composes a projection that covers every gate field alongside caller-specific fields', () => {
    const projection = withPublicDescriptionGateFields('_id slug departments');
    expect(missingPublicDescriptionGateFields(projection)).toEqual([]);
    expect(projection.split(/\s+/)).toContain('departments');
    for (const field of RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS) {
      expect(projection.split(/\s+/)).toContain(field);
    }
  });

  it('agrees with the whole-document verdict for every gate-complete projection', () => {
    const wholeDocument = auditOver(fixtures);
    expect(wholeDocument.counts.violations).toBe(0);

    for (const projection of [
      withPublicDescriptionGateFields('_id slug'),
      savedResearchEntityProjection,
      PUBLIC_RELATED_ENTITY_PROJECTION,
    ]) {
      const projected = auditOver(fixtures.map((entity) => applyProjection(entity, projection)));
      expect(projected.counts).toEqual(wholeDocument.counts);
    }
  });

  it('would have caught the inflated audit: dropping researchAreas invents a violation', () => {
    const wholeDocument = auditOver(fixtures);
    const starved = auditOver(
      fixtures.map((entity) => applyProjection(entity, HISTORICAL_AUDIT_PROJECTION)),
    );

    expect(wholeDocument.counts.violations).toBe(0);
    expect(starved.counts.violations).toBe(1);
    expect(starved.counts.missingPublicCardDescription).toBe(1);
    expect(starved.counts).not.toEqual(wholeDocument.counts);
  });

  it('serves the chip-derived card on a whole document and fails closed without researchAreas', () => {
    expect(researchEntityServesPublicDetail(chipCardEntity)).toBe(true);
    expect(
      researchEntityServesPublicDetail(
        applyProjection(chipCardEntity, HISTORICAL_AUDIT_PROJECTION),
      ),
    ).toBe(false);
  });
});
