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
import { isOrganizationalResearchEntity } from '../utils/researchEntityOrganizational';
import { mapResearchGroupKindToEntityType } from '../models/researchAccessTypes';
import {
  isResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { resolveServedShortDescription } from '../utils/groundedCardSynthesis';
import { stripBodyChrome } from '../utils/researchBodyChromeStrip';
import { servedResearchEntityCopy } from './servedResearchEntityCard';

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
//
// `fieldProvenance` was the second omission of that exact shape (#2425). It has
// two independent readers, and an unprojected read silently defeats both:
//   - the gate chain, via `shortDescriptionIsSelfDerivedFromFullDescription`
//     (`researchEntityDescriptionQuality.ts`), which without provenance sees no
//     source on either description, reports the short as independently sourced,
//     and so evaluates the #1721/#1773 restatement guard on a short that should
//     have been excluded from it;
//   - served card copy, via `dropDomainIncoherentUnsourcedResearchAreas`, which
//     without provenance treats every `researchAreas` chip as unsourced,
//     fail-closes the whole array, and loses the derived "Studies <chips>" short.
// On the Dev corpus measured for #2425 the copy path was the one that bit (181
// rows corrected) while no gate verdict happened to flip, but the gate reader
// above means a flip is possible and that zero is a corpus fact, not a bound.
//
// Projecting the field is necessary but not sufficient. #2898 lost it a third
// way: the detail route reads whole documents, so nothing was unprojected, and
// then narrowed the document one step before the sanitizer and dropped the field
// on the way. A narrowing step on a serve path must keep every field listed here
// for the same reason a projection must include them; what the detail route's
// `publicResearchDetailGroup` withholds is pinned disjoint from this list.
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
  'fieldProvenance',
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
  /**
   * The card line resolved from the copy the canonical serve sanitizer produces,
   * which is what every verdict in this representation is computed on. It is not
   * always `entity.shortDescription`: that field stays the pre-sanitizer resolution
   * the DTO re-reads, because the sanitizer's chip-coherence rescue needs the card
   * it withheld (#3097).
   */
  servedCard: string;
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
  // Strip the two content-independent chrome shapes before anything assesses the
  // body, so the quality verdict, the card resolution and the served copy all see
  // the same text (#2593). This never drops a sentence: see the module header for
  // the precision measurement that rejected the sentence-dropping design.
  const chromeStrippedFullDescription = stripBodyChrome(sanitizedSourceEntity.fullDescription).body;
  const bodyBeforeServeHygiene =
    chromeStrippedFullDescription || sanitizedSourceEntity.fullDescription;
  const sanitizedEntity: Record<string, any> = {
    ...sanitizedSourceEntity,
    entityType: resolvedEntityType,
    fullDescription: bodyBeforeServeHygiene,
    shortDescription: resolveServedShortDescription({
      shortDescription: sanitizedSourceEntity.shortDescription,
      fullDescription: bodyBeforeServeHygiene,
      researchAreas: sanitizedSourceEntity.researchAreas,
      entityType: resolvedEntityType,
      kind: sanitizedSourceEntity.kind,
    }),
  };
  // The card the gate JUDGES, as opposed to the one `entity` carries for the DTO to
  // re-read. It is resolved from the copy the canonical serve sanitizer produces,
  // not from the three-step subset above, because each of the four steps this adds
  // moves the card: the off-entity guard blanks a stored card describing a
  // third-party organization (#3067), chip hygiene drops the chips a chip summary
  // names, body hygiene shortens the body a derived card came from, and the name
  // guards change whose prose the text layer reads this as. Judging the subset's
  // value let the gate clear a row on a line no surface renders, and the row then
  // reached students as a name with nothing under it (#3097).
  //
  // Only the VERDICT reads this. `entity.shortDescription` above stays the subset
  // resolution because the DTO re-runs the whole serve chain over `entity`, and the
  // sanitizer's chip-coherence rescue reads the card it withheld: substituting the
  // judged card there costs a row whose only text grounding its chips was the
  // withheld card every chip it had (#2480).
  //
  // The body withhold reaches the card and not the body invariant. A card derived
  // from prose no surface serves is a phantom, which is this defect; a withheld body
  // that failed `quality.full` would 404 the row rather than correct what it says,
  // and #2911 settled that such a row keeps its lead, links and chips instead of
  // vanishing.
  //
  // What is deliberately NOT read is the DTO's last-resort card
  // (`servedShortDescriptionFallback`, which serves the whole body in the card slot
  // when nothing derives). That resort only ever runs on a row this invariant has
  // already passed, so reading it here would be circular: the card invariant could
  // never refuse an empty card while a body existed, and #2597's refusal and #1872's
  // organizational exemption both key on card absence.
  const servedCopy = servedResearchEntityCopy(sanitizedEntity, resolvedLeadMemberNames);
  const servedCard = resolveServedShortDescription({
    shortDescription: servedCopy.shortDescription,
    fullDescription: servedCopy.fullDescription,
    researchAreas: servedCopy.researchAreas,
    entityType: resolvedEntityType,
    kind: servedCopy.kind,
  });
  const programLike = isProgramLikeResearchEntity(sanitizedEntity);
  const cardIsOptional = programLike || isOrganizationalResearchEntity(sanitizedEntity);
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: sanitizedEntity.fullDescription,
    shortDescription: servedCard,
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
  const rawShortDescription = textValue(servedCard);
  const servedFullDescription = sanitizeResearchEntityDescription(rawFullDescription);
  const servedShortDescription = sanitizeResearchEntityShortDescription(rawShortDescription);
  // A program-like home's student-facing copy describes what the program offers
  // and how to apply, and an organizational home's describes what the
  // organization is and does; neither is a lab-style "Studies X" research focus,
  // so the research-focus card invariant is the wrong bar for either: require a
  // useful full description (and non-blank served copy below) but do not
  // additionally demand a lab-style card. This mirrors the program-specific
  // visibility path (`computeProgramStudentVisibility`) and the matching
  // exemption in `studentVisibilityTier`, which must agree with this one or the
  // gate publishes a row this route then refuses (#1872).
  // This invariant decides whether the route SERVES the page, so it asks whether
  // there is anything to show, not whether what there is scores well. Card
  // quality is the gate's question: `studentVisibilityTier` holds a row on
  // `missing_card_description` from `quality.repairFlags`, computed
  // independently of this reason, so a thin card still keeps a row unpublished.
  //
  // Keying the refusal on `quality.short.isUseful` made the served page depend on
  // a verdict that moves when the BODY changes, because
  // `shortDescriptionQuality` scores the short relative to the full. A body edit
  // anywhere could therefore flip a byte-identical card to failing and 404 a row
  // the list still advertised, while the card itself still rendered. That is the
  // recurrence mechanism in #2597: the class read 0 one morning and 6 by that
  // evening after four unrelated body changes. Refusing only an EMPTY card makes
  // the verdict a function of what renders, so a body change cannot reopen it.
  const reasons: ResearchEntityPublicDescriptionRepresentation['invariant']['reasons'] = [];
  if (!quality.full.isUseful) reasons.push('missing_public_full_description');
  if (!servedShortDescription && !cardIsOptional) {
    reasons.push('missing_public_card_description');
  }
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
    servedCard,
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
// Those two figures are a SNAPSHOT, not a contract. Re-measured 2026-09-13 across
// all three environments: 8 tier-admitted rows fail here, 3 of which the detail
// path serves, and the reverse case did not reproduce (#2597). The direction of
// the warning is what is load-bearing; the counts move with the corpus. Measure
// before quoting them, with `--corpus-reachability` on the served-corpus
// scoreboard.
//
// This predicate stays name-agnostic. #2240 resolved the sibling asymmetry it used
// to warn about - browse CARD COPY now runs the lead-name-aware guard, because
// `searchResearchGroupsViaMeili` batches one roster read per page the way it
// already batches planning contexts - but the browse GATE deliberately still runs
// without names. Supplying them here would make a hit set's admission depend on a
// non-monotonic transform, which is the mechanism that hides a card whose detail
// page serves. Copy and admission are separate questions: repairing the copy
// cannot drop a row, and this predicate never reads the lead names.
//
// The deceased-lead check (#982) is name-agnostic (entity name and description
// signals only) and mirrors the detail resolver's own guard.
export const researchEntityServesPublicDetail = (entity: Record<string, any>): boolean =>
  buildResearchEntityPublicDescriptionRepresentation({ entity }).invariant.pass &&
  !researchEntityHasDeceasedLead(entity);
