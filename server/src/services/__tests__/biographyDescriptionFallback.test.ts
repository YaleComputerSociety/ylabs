import { describe, expect, it } from 'vitest';

import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import {
  BIOGRAPHY_DESCRIPTION_FALLBACK_REASON,
  computeResearchEntityStudentVisibility,
  isStudentReadySoftSignalReason,
} from '../studentVisibilityTier';
import { isBlockingVisibilityReason } from '../studentVisibilityGateService';

const BIOGRAPHY_CARD =
  'Synthetic Scholar is a founding associate of the Synthetic Reef Center and is currently head of the coral settlement program at a coastal institute.';

const RESEARCH_BODY =
  'Synthetic Scholar studies how coral larvae settle on reef substrates under changing ocean temperature. The work combines field settlement assays with survival models of the resulting colonies across seasons.';

const BIOGRAPHY_BODY =
  'Synthetic Scholar is Professor of Ecology and Chair of the Department of Synthetic Studies. Synthetic Scholar completed a BA in Biology in 1990 and a PhD in Ecology in 1997. Synthetic Scholar was appointed to an endowed chair in 2011 and has served as Deputy Dean. Current research interests include coral larval settlement and reef recovery after warming events.';

const row = (overrides: Record<string, any>): Record<string, any> => ({
  slug: 'fixture-biography-fallback',
  name: 'Synthetic Scholar Reef Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: [],
  sourceUrls: ['https://example.edu/fixture-biography-fallback'],
  ...overrides,
});

const detailCard = (entity: Record<string, any>): string =>
  String(toPublicResearchEntityDto(entity, {}).shortDescription || '');

const browseCard = (entity: Record<string, any>): string =>
  String(toPublicResearchEntityDto(entity, { forList: true }).cardDescription?.text || '');

describe('the card prefers a research line over a biography line (#4288)', () => {
  it('serves a research card derived from the body over a stored biography card, on browse and detail alike', () => {
    const entity = row({ shortDescription: BIOGRAPHY_CARD, fullDescription: RESEARCH_BODY });
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });
    const card = detailCard(representation.entity);

    expect(card).not.toBe('');
    expect(card).not.toBe(BIOGRAPHY_CARD);
    expect(browseCard(representation.entity)).toBe(card);
    expect(representation.cardDescription).toBe(card);
  });

  it('keeps a stored biography card when the body derives no research line', () => {
    const body = 'Synthetic Scholar joined the faculty in 2004 and was named a fellow in 2015.';
    const entity = row({ shortDescription: BIOGRAPHY_CARD, fullDescription: body });
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity });

    expect(detailCard(representation.entity)).toBe(BIOGRAPHY_CARD);
    expect(browseCard(representation.entity)).toBe(BIOGRAPHY_CARD);
  });
});

describe('a row serving a biography is flagged, never held (#4288)', () => {
  it('records the soft biography reason on a row whose served body is a biography', () => {
    const verdict = computeResearchEntityStudentVisibility({
      entity: row({ fullDescription: BIOGRAPHY_BODY }),
      leadMembers: [],
    });
    expect(verdict.reasons).toContain(BIOGRAPHY_DESCRIPTION_FALLBACK_REASON);
  });

  it('does not record it on a row whose served body is research prose', () => {
    const verdict = computeResearchEntityStudentVisibility({
      entity: row({ fullDescription: RESEARCH_BODY }),
      leadMembers: [],
    });
    expect(verdict.reasons).not.toContain(BIOGRAPHY_DESCRIPTION_FALLBACK_REASON);
  });

  it('classifies the reason as a soft signal that never blocks', () => {
    expect(isStudentReadySoftSignalReason(BIOGRAPHY_DESCRIPTION_FALLBACK_REASON)).toBe(true);
    expect(isBlockingVisibilityReason(BIOGRAPHY_DESCRIPTION_FALLBACK_REASON)).toBe(false);
  });
});
