import { describe, expect, it } from 'vitest';

import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';
import { buildResearchEntityQualitySummary } from '../researchEntityQuality';
import { computeResearchEntityStudentVisibility } from '../studentVisibilityTier';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from '../../utils/writtenDescriptionSource';
import { CARD_SYNTHESIS_MAX_CHARACTERS } from '../../utils/groundedCardSynthesis';

const COPIED_SOURCE = 'lab-microsite-description-llm';
const CARD_LENGTH_BODY =
  'Works on algebraic geometry and number theory. Recent work concerns moduli spaces of curves.';
const LONGER_BODY =
  'Works on algebraic geometry and number theory. Recent work concerns moduli spaces of curves, their tropical compactifications and arithmetic surfaces over global number fields.';

const rowWith = (body: string, sourceName: string) => ({
  name: 'Synthetic Geometry Group',
  displayName: 'Synthetic Geometry Group',
  kind: 'lab',
  entityType: 'LAB',
  fullDescription: body,
  shortDescription: body,
  researchAreas: ['Algebraic Geometry'],
  websiteUrl: 'https://example.edu/geometry',
  fieldProvenance: {
    fullDescription: { sourceName },
    shortDescription: { sourceName },
  },
});

const cardVerdict = (entity: Record<string, any>) => {
  const publicDescription = buildResearchEntityPublicDescriptionRepresentation({ entity });
  return {
    servedCard: publicDescription.servedCard,
    cardState: publicDescription.quality.cardState,
    qualityFlags: buildResearchEntityQualitySummary({ entity, publicDescription }).repairFlags,
    gateReasons: computeResearchEntityStudentVisibility({ entity, leadMembers: [] }).reasons,
  };
};

describe('a card-length written body serves as its own card (#5537)', () => {
  it('counts the body as a complete card on the serving and gate paths', () => {
    expect(CARD_LENGTH_BODY.length).toBeLessThanOrEqual(CARD_SYNTHESIS_MAX_CHARACTERS);
    const verdict = cardVerdict(rowWith(CARD_LENGTH_BODY, WRITTEN_DESCRIPTION_SOURCE_NAME));

    expect(verdict.servedCard).toBe(CARD_LENGTH_BODY);
    expect(verdict.cardState).toBe('complete');
    expect(verdict.qualityFlags).not.toContain('missing_card_description');
    expect(verdict.gateReasons).not.toContain('missing_card_description');
  });

  it('still refuses a card restating a written body longer than a card', () => {
    expect(LONGER_BODY.length).toBeGreaterThan(CARD_SYNTHESIS_MAX_CHARACTERS);
    const verdict = cardVerdict(rowWith(LONGER_BODY, WRITTEN_DESCRIPTION_SOURCE_NAME));

    expect(verdict.servedCard).toBe(LONGER_BODY);
    expect(verdict.cardState).toBe('sparse');
    expect(verdict.gateReasons).toContain('missing_card_description');
  });

  it('keeps refusing a card that restates a copied body of card length', () => {
    const verdict = cardVerdict(rowWith(CARD_LENGTH_BODY, COPIED_SOURCE));

    expect(verdict.cardState).toBe('sparse');
    expect(verdict.qualityFlags).toContain('missing_card_description');
    expect(verdict.gateReasons).toContain('missing_card_description');
  });
});
