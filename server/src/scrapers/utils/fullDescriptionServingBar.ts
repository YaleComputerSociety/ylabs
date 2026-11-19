import { buildResearchEntityPublicDescriptionRepresentation } from '../../services/researchEntityPublicDescription';
import { servedResearchEntityCopy } from '../../services/servedResearchEntityCard';
import { withHarvestTextDefectsCorrected } from '../observationFieldSanitizer';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** The stored row and its lead, which is the row context the serving bar judges a body in. */
export interface ServingRowContext {
  entity: Record<string, unknown>;
  leadPersonName: string;
}

function servingRepresentationForCandidate(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  candidateText: string,
  leadPersonName: string,
) {
  const projectedFields = Object.fromEntries(
    Object.entries(projected).filter(([field]) => !field.includes('.')),
  );
  // Topic canonicalization and derivation run after the description is chosen, so the
  // stored topics are what the gate will judge the body against (#4280).
  const researchAreas = entityDoc?.researchAreas ?? projectedFields.researchAreas;
  // Judged as the row will store it: the stored-text normalization runs at the end of
  // the pass and repairs harvest defects such as glued sentences (#4280).
  const storedText = String(withHarvestTextDefectsCorrected('fullDescription', candidateText));
  const entity = {
    ...(entityDoc || {}),
    ...projectedFields,
    researchAreas,
    fullDescription: storedText,
  };
  const leadMemberNames = leadPersonName ? [leadPersonName] : [];
  return {
    leadMemberNames,
    representation: buildResearchEntityPublicDescriptionRepresentation({ entity, leadMemberNames }),
  };
}

/**
 * The serving check's own verdict on a candidate body, asked of the row as this pass
 * would leave it. The adoption bar used to be `fullDescriptionQuality` alone, which is
 * weaker than the serve chain's sanitizers, so a body could win the field and then be
 * refused at serve time while a body that serves sat lower in the ranked list (#3437).
 * Calling the serving function itself, rather than restating it, is what keeps the two
 * bars one predicate.
 */
export function servingBarAcceptsFullDescription(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  candidateText: string,
  leadPersonName: string,
): boolean {
  const { representation, leadMemberNames } = servingRepresentationForCandidate(
    entityDoc,
    projected,
    candidateText,
    leadPersonName,
  );
  return (
    representation.strictQuality.full.isUseful &&
    textValue(servedResearchEntityCopy(representation.entity, leadMemberNames).fullDescription)
      .length > 0
  );
}

export function servingBarAcceptsDescriptionPair(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  candidateText: string,
  leadPersonName: string,
): boolean {
  const { representation } = servingRepresentationForCandidate(
    entityDoc,
    projected,
    candidateText,
    leadPersonName,
  );
  return representation.invariant.pass && representation.strictQuality.full.isUseful;
}

/**
 * The serving check's verdict on a card beside a written body, asked of the row as this
 * pass would leave it: the public description invariant passes and the card the gate
 * judges is complete, which is exactly what `missing_card_description` and
 * `public_description_invariant_failed` read.
 */
export function servingBarAcceptsWrittenBodyCard(
  entityDoc: Record<string, unknown> | null | undefined,
  projected: Record<string, unknown>,
  body: string,
  card: string,
  leadPersonName: string,
): boolean {
  const { representation } = servingRepresentationForCandidate(
    entityDoc,
    { ...projected, shortDescription: card },
    body,
    leadPersonName,
  );
  return representation.invariant.pass && representation.quality.cardState === 'complete';
}
