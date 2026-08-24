import {
  assessResearchEntityDescriptionQuality,
  type ResearchEntityDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import {
  sanitizeFacultyResearchEntityCopyFields,
  sanitizeResearchEntityPublicDescriptionFields,
  sanitizeResearchHomeSelfReferenceCopyFields,
} from '../utils/researchEntityDescriptionText';
import { researchEntityHasDeceasedLead } from '../utils/researchEntityDeceasedLead';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';
import {
  isResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { resolveServedShortDescription } from '../utils/groundedCardSynthesis';

export interface ResearchEntityPublicDescriptionRepresentation {
  entity: Record<string, any>;
  leadMemberNames: string[];
  quality: ResearchEntityDescriptionQuality;
  fullDescription: string;
  cardDescription: string;
  invariant: {
    pass: boolean;
    fullDescriptionUseful: boolean;
    cardDescriptionUseful: boolean;
    reasons: Array<
      | 'missing_public_full_description'
      | 'missing_public_card_description'
      | 'blank_served_public_description'
      | 'research_area_echo_description'
    >;
  };
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function memberDisplayName(member: Record<string, any>): string {
  const candidates = [
    member.user?.displayName,
    member.user?.name,
    [member.user?.fname, member.user?.lname].filter(Boolean).join(' '),
    member.facultyMember?.displayName,
    member.facultyMember?.name,
    [member.facultyMember?.firstName, member.facultyMember?.lastName].filter(Boolean).join(' '),
    member.displayName,
    member.name,
  ];
  return candidates.map(textValue).find(Boolean) || '';
}

export function publicDescriptionLeadMemberNames(
  leadMembers: Array<Record<string, any>> = [],
): string[] {
  return Array.from(new Set(leadMembers.map(memberDisplayName).filter(Boolean)));
}

export function buildResearchEntityPublicDescriptionRepresentation({
  entity,
  leadMembers = [],
  leadMemberNames,
}: {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  leadMemberNames?: readonly string[];
}): ResearchEntityPublicDescriptionRepresentation {
  const resolvedLeadMemberNames = Array.from(
    new Set(
      (leadMemberNames || publicDescriptionLeadMemberNames(leadMembers))
        .map(textValue)
        .filter(Boolean),
    ),
  );
  const sanitizedSourceEntity = sanitizeResearchHomeSelfReferenceCopyFields(
    sanitizeFacultyResearchEntityCopyFields(
      sanitizeResearchEntityPublicDescriptionFields(entity, resolvedLeadMemberNames),
      resolvedLeadMemberNames,
    ),
  );
  // A shortDescription synthesized independently of fullDescription can fail
  // hygiene (a dangling pronoun opener, an artwork-commentary chrome prefix)
  // or reduce to empty on a par with fullDescription's own richer content
  // (#1506). Resolve it from the entity's own fullDescription before quality
  // assessment so the card served here - and the invariant computed below -
  // both reflect the corrected value rather than the independently-synthesized
  // one. The sanitize helpers above return the input entity by reference when
  // they change nothing, so build a fresh object here rather than assigning in
  // place: mutating the resolved short onto a shared reference corrupts the
  // caller's stored entity (e.g. the repair queue's own backfill diagnosis).
  const sanitizedEntity: Record<string, any> = {
    ...sanitizedSourceEntity,
    shortDescription: resolveServedShortDescription({
      shortDescription: sanitizedSourceEntity.shortDescription,
      fullDescription: sanitizedSourceEntity.fullDescription,
      researchAreas: sanitizedSourceEntity.researchAreas,
      entityType: sanitizedSourceEntity.entityType,
    }),
  };
  const programLike = isProgramLikeResearchEntity(sanitizedEntity);
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: sanitizedEntity.fullDescription,
    shortDescription: sanitizedEntity.shortDescription,
    researchAreas: sanitizedEntity.researchAreas,
    sourceUrls: sanitizedEntity.sourceUrls,
    website: sanitizedEntity.website,
    websiteUrl: sanitizedEntity.websiteUrl,
    isProgramLike: programLike,
    entityType: sanitizedEntity.entityType,
  });
  // The public DTO runs a second read-time hygiene pass over the served copy
  // (`sanitizeResearchEntityShortDescription`/`sanitizeResearchEntityDescription`)
  // that the quality assessment above does not, so a card can clear the quality
  // invariant yet serve an empty description once that hygiene strips CTA/news
  // chrome (#932) or roster-shaped prose. Assess the actually-served copy and
  // fail closed when both fields reduce to empty so a stored `student_ready`
  // entity never renders a blank detail page (#998 precedent). Idempotent with
  // the DTO's own pass, and name-agnostic like the rest of this gate.
  const rawFullDescription = textValue(sanitizedEntity.fullDescription);
  const rawShortDescription = textValue(sanitizedEntity.shortDescription);
  const servedFullDescription = sanitizeResearchEntityDescription(rawFullDescription);
  const servedShortDescription = sanitizeResearchEntityShortDescription(rawShortDescription);
  // A program-like home's student-facing copy describes what the program offers
  // and how to apply, not a lab-style "Studies X" research focus, so the
  // research-focus card invariant is the wrong bar for it: require a useful full
  // description (and non-blank served copy below) but do not additionally demand
  // a lab-style card. This mirrors the program-specific visibility path
  // (`computeProgramStudentVisibility`) and keeps projected RA_PROGRAM /
  // FELLOWSHIP_PROGRAM homes (#1381) servable on the detail page.
  const reasons: ResearchEntityPublicDescriptionRepresentation['invariant']['reasons'] = [];
  if (!quality.full.isUseful) reasons.push('missing_public_full_description');
  if (!quality.short.isUseful && !programLike) reasons.push('missing_public_card_description');
  if (!servedFullDescription && !servedShortDescription) {
    reasons.push('blank_served_public_description');
  }
  // quality.full/short.isUseful accepts this echo template (#1417); check it independently so a
  // sibling field surviving sanitization can't mask the other field going blank at serve.
  if (
    (rawFullDescription &&
      !servedFullDescription &&
      isResearchAreaEchoDescription(rawFullDescription)) ||
    (rawShortDescription &&
      !servedShortDescription &&
      isResearchAreaEchoDescription(rawShortDescription))
  ) {
    reasons.push('research_area_echo_description');
  }

  return {
    entity: sanitizedEntity,
    leadMemberNames: resolvedLeadMemberNames,
    quality,
    fullDescription: quality.full.text,
    cardDescription: quality.short.text,
    invariant: {
      pass: reasons.length === 0,
      fullDescriptionUseful: quality.full.isUseful,
      cardDescriptionUseful: quality.short.isUseful,
      reasons,
    },
  };
}

// The stored `studentVisibilityTier` is a materialized snapshot, but every
// public serve path recomputes the servable gate live: the detail resolver
// returns null (-> 404) when it fails, and the browse hydration path drops the
// card. A stored `student_ready` tier can go stale relative to that live gate
// (e.g. after a hygiene change that empties a person-bio description, or a lead
// later confirmed deceased), so any surface that lists entities by stored tier
// alone must run this predicate to stay consistent with the detail gate. Running
// it without the roster-derived lead names the detail path uses is safe: lead-name
// self-reference stripping only ever removes more text, so an entity that fails
// this name-agnostic invariant necessarily also fails the detail path's stricter
// invariant, and dropping it can never hide a card the detail page would serve.
// The deceased-lead check (#982) is likewise name-agnostic (entity name and
// description signals only) and mirrors the detail resolver's own guard.
export const researchEntityServesPublicDetail = (entity: Record<string, any>): boolean =>
  buildResearchEntityPublicDescriptionRepresentation({ entity }).invariant.pass &&
  !researchEntityHasDeceasedLead(entity);
