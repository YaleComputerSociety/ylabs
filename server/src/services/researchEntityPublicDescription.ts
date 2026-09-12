import {
  assessResearchEntityDescriptionQuality,
  describesResearchFocus,
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

/**
 * Which stored field the detail body resolved to. `short` means the stored
 * `fullDescription` was refused and the card copy is serving as the body, which
 * keeps the detail page from being thinner than its card (#2271).
 */
export type ServedResearchBodySource = 'full' | 'short' | 'none';

export interface ResearchEntityPublicDescriptionRepresentation {
  entity: Record<string, any>;
  leadMemberNames: string[];
  quality: ResearchEntityDescriptionQuality;
  fullDescription: string;
  cardDescription: string;
  bodySource: ServedResearchBodySource;
  invariant: {
    pass: boolean;
    fullDescriptionUseful: boolean;
    cardDescriptionUseful: boolean;
    reasons: Array<
      | 'missing_public_card_description'
      | 'blank_served_public_description'
      | 'research_area_echo_description'
      | 'no_servable_research_prose'
    >;
  };
}

/** A section label pasted in as the body opener rather than prose. */
const LEADING_SECTION_LABEL_RE =
  /^(?:biography|bio|education|publications?|selected\s+publications?|awards?|honou?rs?|appointments?|training|certifications?|memberships?|curriculum\s+vitae|cv|contact|overview)\b[\s:.-]/i;

/** A news or event item pasted in as the body, which opens with its date. */
const LEADING_DATE_RE =
  /^(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|\d{1,2}\/\d{1,2}\/\d{2,4}\b|\d{4}-\d{2}-\d{2}\b)/i;

const DEGREE_TOKEN_RE =
  /\b(?:B\.?A|B\.?S|A\.?B|M\.?A|M\.?S|M\.?Div|M\.?S\.?W|M\.?P\.?H|M\.?B\.?A|Ph\.?D|M\.?D|J\.?D|Ed\.?D|D\.?Phil|D\.?V\.?M|Sc\.?D)\b\.?/g;

/** Directory-style rank and unit abbreviations, the signature of a CV listing. */
const CV_TITLE_ABBREVIATION_RE = /\b(?:Assoc|Asst|Prof|Dept|Adj|Emer)\b\.?/;

const MIN_DESCRIPTIVE_PROSE_WORDS = 15;
const MAX_TITLE_CASE_RATIO = 0.34;

/**
 * The share of non-sentence-initial words that are Title Case. Publication
 * titles, administrative title enumerations, and CV position listings are
 * overwhelmingly Title Case; descriptive prose is overwhelmingly lower case.
 * Acronyms are excluded because a real research sentence cites them freely.
 */
export function titleCaseWordRatio(value: string): number {
  const sentences = value.split(/(?<=[.!?])\s+/);
  let considered = 0;
  let titleCase = 0;
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index].replace(/^[("'“‘]+|[)"'”’,;:.]+$/g, '');
      if (word.length < 2 || !/^[\p{L}]/u.test(word)) continue;
      if (word === word.toUpperCase()) continue;
      considered += 1;
      if (/^[\p{Lu}]/u.test(word)) titleCase += 1;
    }
  }
  return considered === 0 ? 0 : titleCase / considered;
}

/**
 * Structural half of the allowlist: does this read as descriptive sentences
 * about a subject, regardless of whether it uses one of the recognized
 * research-focus phrases.
 *
 * This branch exists because `describesResearchFocus` alone is too narrow to be
 * an allowlist. It refuses "The lab maps how salt-marsh sediments lock away
 * atmospheric carbon along the Atlantic coast." - unambiguously good research
 * prose whose verb simply is not in the focus-phrase set - and withholding rows
 * like that trades a precision problem for a recall problem
 * (`researchEntityDto.test.ts` #2184 caught exactly this).
 *
 * Structure is a tractable allowlist in a way that topic is not: the space of
 * "sentences about a subject" is small and closed, while the space of bad Yale
 * page shapes is unbounded, which is the whole argument of #2573.
 */
export function readsAsDescriptiveProse(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  if (LEADING_SECTION_LABEL_RE.test(text)) return false;
  if (LEADING_DATE_RE.test(text)) return false;
  if (CV_TITLE_ABBREVIATION_RE.test(text)) return false;
  if ((text.match(DEGREE_TOKEN_RE) || []).length >= 2) return false;
  if (!/[.!?]/.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length < MIN_DESCRIPTIVE_PROSE_WORDS) return false;
  if (titleCaseWordRatio(text) > MAX_TITLE_CASE_RATIO) return false;
  return true;
}

/**
 * The positive half of the served-description gate (#2573).
 *
 * The ~25 hygiene predicates this file consumes are a denylist: each was written
 * for the one page shape that motivated it, so it does not generalize to the next
 * instance of its own class. Measured on the #2299 sample, only 12 of 93 served
 * Beta rows trip any predicate and 8 of those are one predicate, and six defect
 * texts copied out of served cards were fed back as positive controls with five
 * silent. The adversary is every page shape on every Yale site, which is
 * unbounded, so a denylist cannot converge and a 26th predicate would not change
 * that.
 *
 * Two positive branches, because either alone is wrong:
 *   - `describesResearchFocus` recognizes a stated research focus, including the
 *     derived "Studies <topics>" card template the fallback depends on. Alone it
 *     is too narrow to be an allowlist: it refuses "The lab maps how salt-marsh
 *     sediments lock away atmospheric carbon", whose verb simply is not in its
 *     phrase set, and withholding rows like that trades a precision problem for a
 *     recall problem.
 *   - `readsAsDescriptiveProse` accepts text that is structurally sentences about
 *     a subject. Structure is a tractable allowlist where topic is not: the space
 *     of "sentences about a subject" is closed, while the space of bad page shapes
 *     is not.
 */
export function servedBodyReadsAsResearchProse(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  return describesResearchFocus(text) || readsAsDescriptiveProse(text);
}

/**
 * The allowlist asserts that a body reads as research prose about this row's own
 * subject, which is the right bar for a lab or a faculty research home and a
 * category error for anything else. A center, institute, initiative, or core
 * facility describes an organization ("brings together researchers in ..."), so
 * requiring a research-focus predication of it withholds correct rows: applying
 * this set-wide dropped four organizational homes in
 * `studentVisibilityTier.test.ts` from `student_ready` to `limited_but_safe`.
 *
 * Scoped deliberately to the types the #2573 defect family actually lives in -
 * all six positive controls are a LAB or a `ysm-faculty-*` research area. Those
 * types keep the pre-existing denylist bar and are unaffected by this change.
 */
const RESEARCH_PROSE_ALLOWLIST_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_RESEARCH',
  'INDIVIDUAL_RESEARCH',
  'FACULTY_PROJECT',
]);

export const researchProseAllowlistApplies = (entity: {
  entityType?: unknown;
  isProgramLike?: boolean;
}): boolean =>
  !entity.isProgramLike &&
  typeof entity.entityType === 'string' &&
  RESEARCH_PROSE_ALLOWLIST_ENTITY_TYPES.has(entity.entityType);

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
  const bodyAllowlistApplies = researchProseAllowlistApplies({
    entityType: sanitizedEntity.entityType,
    isProgramLike: programLike,
  });
  const fullIsServableBody =
    Boolean(servedFullDescription) &&
    quality.full.isUseful &&
    (!bodyAllowlistApplies || servedBodyReadsAsResearchProse(servedFullDescription));
  const shortIsServableBody =
    Boolean(servedShortDescription) &&
    (!bodyAllowlistApplies || servedBodyReadsAsResearchProse(servedShortDescription));
  const bodySource: ServedResearchBodySource = fullIsServableBody
    ? 'full'
    : shortIsServableBody
      ? 'short'
      : 'none';
  // Branch 3 is mandatory, not theoretical: a good short is not a property of
  // the corpus. Development holds 776 rows with neither description, and #2271
  // forbids a detail page thinner than its card, so a row with no servable
  // research prose in either field belongs withheld rather than served with an
  // empty body.
  if (bodySource === 'none') reasons.push('no_servable_research_prose');
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

  // The detail DTO is built from `representation.entity` (see
  // `researchGroupService`, which does `const publicGroup = publicDescription.entity`),
  // so the fallback only reaches the served page if the resolved body is written
  // back onto the entity. Returning it solely on the representation would leave
  // the refused `fullDescription` on the object the DTO reads and serve the very
  // text this gate rejected.
  const servedBody =
    bodySource === 'full'
      ? servedFullDescription
      : bodySource === 'short'
        ? servedShortDescription
        : '';
  const servedEntity: Record<string, any> =
    bodySource === 'short'
      ? { ...sanitizedEntity, fullDescription: servedShortDescription }
      : sanitizedEntity;

  return {
    entity: servedEntity,
    leadMemberNames: resolvedLeadMemberNames,
    quality,
    fullDescription: servedBody,
    cardDescription: quality.short.text,
    bodySource,
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
