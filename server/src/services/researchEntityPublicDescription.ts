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
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  isResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { resolveServedShortDescription } from '../utils/groundedCardSynthesis';

// Every field `buildResearchEntityPublicDescriptionRepresentation` (and so
// `researchEntityServesPublicDetail`) reads. A caller that loads entities with a
// `.select()` projection MUST project all of these: the gate fails closed on a
// field it cannot see, so an omitted field silently drops entities the detail
// page serves perfectly well rather than raising an error. `researchAreas` was
// the omission that mattered - it feeds both the chip-echo card replacement and
// the `buildResearchAreasCardSummary` fallback, so leaving it out made 283
// otherwise-servable student_ready entities vanish from the saved list and the
// related-entities module while remaining visible on browse and detail (which
// read whole documents). Any new gate input must be added here and to
// `publicDescriptionGateProjection` consumers, or that surface will silently
// under-serve again.
export const RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS: readonly string[] = Object.freeze([
  'name',
  'displayName',
  'kind',
  'entityType',
  'shortDescription',
  'fullDescription',
  'profileSynthesisDescription',
  'descriptionSource',
  'researchAreas',
  'sourceUrls',
  'website',
  'websiteUrl',
]);

export const withPublicDescriptionGateFields = (...projections: string[]): string =>
  Array.from(
    new Set(
      [...projections, ...RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS]
        .flatMap((projection) => projection.split(/\s+/))
        .filter(Boolean),
    ),
  ).join(' ');

export const missingPublicDescriptionGateFields = (projection: string): string[] => {
  const projected = new Set(projection.split(/\s+/).filter(Boolean));
  return RESEARCH_ENTITY_PUBLIC_DESCRIPTION_GATE_FIELDS.filter((field) => !projected.has(field));
};

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
  // A document persisted via a raw $set (the common scraper/materializer write
  // path) can carry `kind` without the `entityType` the schema only backfills
  // as a Mongoose default on document creation, so a plain object or a `.lean()`
  // read here can arrive with `entityType` undefined even for a LAB/
  // FACULTY_RESEARCH_AREA record. Falling back to the same kind-derived mapping
  // the DTO layer uses keeps the entityType-gated guards below (the topic-label-
  // list chip-echo check) from silently never firing on such a record (#1732).
  const resolvedEntityType =
    sanitizedSourceEntity.entityType ||
    (sanitizedSourceEntity.kind
      ? mapResearchGroupKindToEntityType(sanitizedSourceEntity.kind)
      : undefined);
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
    entityType: resolvedEntityType,
    shortDescription: resolveServedShortDescription({
      shortDescription: sanitizedSourceEntity.shortDescription,
      fullDescription: sanitizedSourceEntity.fullDescription,
      researchAreas: sanitizedSourceEntity.researchAreas,
      entityType: resolvedEntityType,
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
  // (`computeProgramStudentVisibility`) and keeps program-like homes servable on
  // the detail page.
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
// alone must run this predicate to stay consistent with the detail gate.
//
// This predicate is NOT nested with the detail path, and an earlier version of
// this comment claimed it was. The claim was that running without the
// roster-derived lead names is safe because stripping "only ever removes more
// text", so a name-agnostic failure implies a detail failure. That inference does
// not hold: removing more text is not the same as yielding a monotonically
// stricter verdict, and a text-length argument cannot establish a verdict
// ordering. Two independent mechanisms break it (#2241):
//   - `shortDescriptionQuality(value, fullDescription, ...)` scores the short
//     RELATIVE to the full (`same-as-full`, `copied-first-sentence`), so changing
//     the full flips the verdict on a byte-identical short.
//   - Stripping can CREATE a failure: "Dr. Cohen's research aims to ..." becomes
//     "This research aims to ..." and the stripped short then fails its own
//     quality check. Note the card still RENDERS in that case, falling back to the
//     stripped full, so the lead-aware gate rejects an entity that has usable card
//     copy - the failure is in the stored short's post-strip quality, not in the
//     absence of anything to show.
// Measured on the live corpus: 5 entities fail here but PASS the detail path, and
// 2 do the reverse. So this predicate can hide a card the detail page would serve,
// and it can also pass a card whose detail page 404s. Do not reintroduce a nesting
// or monotonicity assumption in either direction.
//
// Do not "fix" that by calling the detail sanitizer from the browse path: it
// needs roster-derived lead names that browse deliberately does not fetch, and
// because the transform is not monotonic it could newly hide cards whose detail
// pages serve correctly. #2240 holds the options and the decision.
//
// The deceased-lead check (#982) is name-agnostic (entity name and description
// signals only) and mirrors the detail resolver's own guard.
export const researchEntityServesPublicDetail = (entity: Record<string, any>): boolean =>
  buildResearchEntityPublicDescriptionRepresentation({ entity }).invariant.pass &&
  !researchEntityHasDeceasedLead(entity);
