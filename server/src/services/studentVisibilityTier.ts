import { type StudentVisibilityTier } from '../models/studentVisibility';
import { isProfileAreaShellEntity } from '../utils/profileAreaDuplicateRisk';
import {
  isStudiesResearchAreaEchoDescription,
  sanitizeCatalogDescription,
} from '../utils/descriptionHygiene';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { buildResearchEntityPublicDescriptionRepresentation } from './researchEntityPublicDescription';
import { buildResearchEntityQualitySummary } from './researchEntityQuality';
import { classifyProgramResearchRelevance } from './programResearchRelevance';
import { classifyResearchEntityResearchScope } from './researchEntityResearchScope';
import { detectProfileIdentityRisk } from './leadProfileIdentity';
import { isProgramLikeResearchEntity } from '../utils/researchEntityProgramLike';

export const STUDENT_VISIBILITY_VERSION = 'student-visibility-v2';

export function isStudentVisibilityVersionCurrent(version: unknown): boolean {
  return version === STUDENT_VISIBILITY_VERSION;
}

export interface StudentVisibilityResult {
  tier: StudentVisibilityTier;
  computedTier: StudentVisibilityTier;
  reasons: string[];
}

export interface ResearchEntityStudentVisibilityInput {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  accessSignalCount?: number;
  actionablePathwayCount?: number;
  openPostedOpportunityCount?: number;
  duplicateRisk?: boolean;
  exactUrlDuplicateRisk?: boolean;
  contentPageRisk?: boolean;
  relatedEntityAccessPathCount?: number;
}

export function hasProfileAreaShellDuplicateRisk({
  entity,
  leadMembers = [],
  concreteLeadEntityUserIds,
}: {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  concreteLeadEntityUserIds: Set<string>;
}): boolean {
  if (!isProfileAreaShellEntity(entity)) return false;
  return leadMembers.some((member) => {
    const userId =
      member.userId === undefined || member.userId === null ? '' : String(member.userId).trim();
    return userId && concreteLeadEntityUserIds.has(userId);
  });
}

export interface ProgramStudentVisibilityInput extends Record<string, any> {
  title?: string;
  studentFacingCategory?: string;
  sourceUrl?: string;
  applicationLink?: string;
  links?: Array<{ url?: string }>;
  undergraduateOnly?: boolean;
  yaleCollegeOnly?: boolean;
  programKind?: string;
  entryMode?: string;
  mentorMatching?: boolean;
  requiresMentorBeforeApply?: boolean;
  purpose?: string[];
  summary?: string;
  description?: string;
  eligibility?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const hasAnyHttpUrl = (values: unknown[]): boolean => values.some(hasHttpUrl);

const entityUrls = (entity: Record<string, any>): string[] =>
  [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]
    .map(textValue)
    .filter((value) => /^https?:\/\//i.test(value));

const genericDirectoryUrlPathPatterns = [
  /\/(?:people|faculty|professors|directory|members|membership\/directory|humans\/faculty)\/?$/i,
];

function isGenericDirectoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '') || '/';
    return genericDirectoryUrlPathPatterns.some((pattern) => pattern.test(path));
  } catch {
    return false;
  }
}

function isGenericDirectoryOnlyProfileAreaShell(entity: Record<string, any>): boolean {
  if (!isProfileAreaShellEntity(entity)) return false;
  const urls = entityUrls(entity);
  if (urls.length === 0) return false;
  return urls.every(isGenericDirectoryUrl);
}

function isYaleProfileOrDirectoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '') || '/';
    if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return false;
    return isGenericDirectoryUrl(value) || /\/(?:[^/]+\/)?profile\/[^/]+$/i.test(path);
  } catch {
    return false;
  }
}

function isProfileBiographyShell({
  entity,
  leadState,
  descriptionState,
  hasActionEvidence,
}: {
  entity: Record<string, any>;
  leadState: string;
  descriptionState: string;
  hasActionEvidence: boolean;
}): boolean {
  if (!isProfileAreaShellEntity(entity)) return false;
  if (descriptionState !== 'thin') return false;
  if (leadState === 'lead_attached') return false;
  if (hasUsefulResearchAreas(entity)) return false;
  if (hasActionEvidence) return false;

  const urls = entityUrls(entity);
  return urls.length > 0 && urls.every(isYaleProfileOrDirectoryUrl);
}

function hasUsefulResearchAreas(entity: Record<string, any>): boolean {
  return (
    Array.isArray(entity.researchAreas) && entity.researchAreas.some((area) => textValue(area))
  );
}

const RESEARCH_AREA_FACET_REQUIRED_ENTITY_TYPES = new Set(['LAB', 'FACULTY_RESEARCH_AREA']);

function missingFacultyResearchAreaFacetSignal(entity: Record<string, any>): boolean {
  return (
    RESEARCH_AREA_FACET_REQUIRED_ENTITY_TYPES.has(entity.entityType) &&
    !hasUsefulResearchAreas(entity)
  );
}

// Must stay consistent with accessMaterializer's ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES:
// the materializer emits a lead-optional organizational REACH_OUT_PLAUSIBLE
// ways-in for exactly these types, so any type it treats as organizational must
// also be lead-exempt here or the class is stranded on missing_lead forever
// despite carrying that signal (the ARCHIVE_OR_MUSEUM_PROJECT Beinecke/Peabody
// curatorial units were minted lead-optional by design yet held on missing_lead
// because this set omitted the type, issue #1367).
const ORGANIZATIONAL_ENTITY_TYPES = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
]);

/**
 * Organizational research homes (centers, institutes, initiatives, core
 * facilities, library collections initiatives, archive/museum projects, and
 * digital-humanities projects) are institutionally contactable: the entity
 * itself, via its official page and programs, is the way in, so a single
 * named individual lead is NOT required for student visibility. (Many real Yale
 * centers are dean- or committee-led and never publish a single "director";
 * library collections and archive/museum homes are curated by the library or
 * museum and contactable via their official page.) A named director is still
 * surfaced when known, but its absence should not hide a well-described,
 * source-backed organizational home from students.
 */
function isOrganizationalResearchEntity(entity: Record<string, any>): boolean {
  return ORGANIZATIONAL_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase());
}

const organizationalEngagementUrlPathPatterns = [
  /\/(?:people|staff|team|members?|membership|our-people|who-we-are|leadership)(?:\/|$)/i,
  /\/(?:get-involved|getinvolved|join(?:-us)?|participate|volunteer|opportunities|apply|how-to-apply|admissions)(?:\/|$)/i,
  /\/(?:programs?|education|academics|training|courses?|fellowships?|internships?|research-opportunities|for-students|students)(?:\/|$)/i,
  // Student-research engagement tokens carried mid-segment (e.g.
  // /undergraduate-program/undergraduate-research-in-x, /research-internship-program,
  // /research/undergraduate-research-opportunities, /undergraduates/senior-essay,
  // /what-directed-research-course). The segment-anchored patterns above miss these
  // even though the page itself is the student's way in. Directed/independent-research
  // and independent-study pages are the for-credit course pathway's own way in.
  /(?:^|[/-])(?:undergraduate-research|undergraduate-study|undergraduate-program|undergraduates|undergraduate|undergrad|directed-research|independent-research|independent-study|research-internship|research-opportunit(?:y|ies)|research-assistantships?|research-experience|for-undergraduates?)(?:[/-]|$)/i,
];

function isOrganizationalEngagementUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/g, '') || '/';
    if (path === '/') return false;
    return organizationalEngagementUrlPathPatterns.some((pattern) => pattern.test(path));
  } catch {
    return false;
  }
}

function hasOrganizationalEngagementLink(entity: Record<string, any>): boolean {
  return entityUrls(entity).some(isOrganizationalEngagementUrl);
}

function hasOrganizationalAlternateAccessPath({
  entity,
  relatedEntityAccessPathCount,
}: {
  entity: Record<string, any>;
  relatedEntityAccessPathCount: number;
}): boolean {
  if (relatedEntityAccessPathCount > 0) return true;
  return hasOrganizationalEngagementLink(entity);
}

function memberUserRecord(member: Record<string, any>): Record<string, any> {
  if (member.user && typeof member.user === 'object') return member.user;
  const user = member.userId;
  return user && typeof user === 'object' ? user : {};
}

function isNonOwnerResearchTitle(value: unknown): boolean {
  const title = textValue(value).toLowerCase();
  if (!title) return false;
  return (
    /\bpostdoctoral\b|\bpostdoc\b/.test(title) ||
    /\bresearch affiliates?\b/.test(title) ||
    /\bassociate research scientist\b/.test(title)
  );
}

function isGrantOrOrcidSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host === 'reporter.nih.gov' ||
      host === 'api.reporter.nih.gov' ||
      host === 'www.nsf.gov' ||
      host === 'api.nsf.gov' ||
      host === 'www.osti.gov' ||
      host === 'osti.gov' ||
      host === 'orcid.org'
    );
  } catch {
    return false;
  }
}

const ORG_ENTITY_TYPES_INCOHERENT_WITH_LAB_NAME = new Set(['CENTER', 'INSTITUTE']);

const LAB_NAME_EPONYM_STOPWORDS = new Set([
  'yale',
  'the',
  'research',
  'center',
  'centre',
  'institute',
  'program',
  'programme',
  'national',
  'joint',
  'core',
]);

function labNameEponymToken(name: string): string {
  const match = /(\b[A-Za-z][\w'-]{2,})\s+lab(?:oratory)?$/i.exec(name.trim());
  if (!match) return '';
  const token = match[1].toLowerCase();
  return LAB_NAME_EPONYM_STOPWORDS.has(token) ? '' : token;
}

function labNameCoherentWithDescription(entity: Record<string, any>): boolean {
  const eponym = labNameEponymToken(textValue(entity.name || entity.displayName));
  if (!eponym) return false;
  const description = `${textValue(entity.shortDescription)} ${textValue(
    entity.fullDescription,
  )}`.toLowerCase();
  return new RegExp(`\\b${eponym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(description);
}

/**
 * A "<Person> Lab"-named entity whose entityType resolved to an org type
 * (CENTER/INSTITUTE/PROGRAM) - the ingestion-time name mint and the
 * entityType/description resolver ran independently and never reconciled, so
 * the card's title, type badge, and body describe two different things
 * (#1445). Held out of student_ready/limited_but_safe rather than suppressed,
 * since the entity itself may still be legitimate once reconciled. A
 * legitimately named laboratory whose eponym also appears in its own
 * description (e.g. "Yale Wright Laboratory" described as "Wright Lab develops
 * experiments...") is self-coherent, so the name/body do not describe two
 * different things and the guard does not fire.
 */
function isLabNameOrgTypeMismatch(entity: Record<string, any>): boolean {
  if (!/\blab(?:oratory)?$/i.test(textValue(entity.name || entity.displayName))) return false;
  if (!ORG_ENTITY_TYPES_INCOHERENT_WITH_LAB_NAME.has(textValue(entity.entityType).toUpperCase())) {
    return false;
  }
  return !labNameCoherentWithDescription(entity);
}

function isNonOwnerGrantShell({
  entity,
  leadMembers,
  hasActionEvidence,
}: {
  entity: Record<string, any>;
  leadMembers: Array<Record<string, any>>;
  hasActionEvidence: boolean;
}): boolean {
  if (hasActionEvidence) return false;
  if (!/\blab(?:oratory)?$/i.test(textValue(entity.name || entity.displayName))) return false;
  const urls = entityUrls(entity);
  if (urls.length === 0 || !urls.every(isGrantOrOrcidSourceUrl)) return false;
  return leadMembers.some((member) => {
    const user = memberUserRecord(member);
    return isNonOwnerResearchTitle(user.title || member.title);
  });
}

const FORMALIZATION_PROGRAM_KINDS = new Set([
  'FELLOWSHIP_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'SENIOR_THESIS_FUNDING',
]);

const ENTRY_PROGRAM_KINDS = new Set([
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
]);

const ENTRY_PROGRAM_MODES = new Set([
  'APPLY_TO_PROGRAM',
  'APPLY_TO_PROJECT',
  'DIRECT_FACULTY_MATCHING',
]);

const formalizationCategoryPattern =
  /\b(funding after mentor|research travel funding|senior research funding|grant|fellowship funding|travel funding|summer research funding|project funding)\b/i;

function isFormalizationOnlyProgram(program: ProgramStudentVisibilityInput): boolean {
  const kind = textValue(program.programKind).toUpperCase();
  const entryMode = textValue(program.entryMode).toUpperCase();
  const category = textValue(program.studentFacingCategory);

  if (program.mentorMatching === true) return false;
  if (ENTRY_PROGRAM_KINDS.has(kind)) return false;
  if (ENTRY_PROGRAM_MODES.has(entryMode)) return false;
  if (FORMALIZATION_PROGRAM_KINDS.has(kind)) return true;
  if (entryMode === 'SECURE_MENTOR_THEN_APPLY' || program.requiresMentorBeforeApply === true)
    return true;
  return formalizationCategoryPattern.test(category);
}

type ProgramPublicDescriptionState = 'present' | 'thin' | 'missing';

const MIN_PROGRAM_PUBLIC_DESCRIPTION_WORDS = 6;

const usablePublicDescriptionText = (value: unknown): string =>
  typeof value === 'string'
    ? textValue(redactDirectContactInfo(sanitizeCatalogDescription(value)))
    : '';

const wordCount = (value: string): number => value.split(/\s+/).filter(Boolean).length;

function programPublicDescriptionState(
  program: ProgramStudentVisibilityInput,
): ProgramPublicDescriptionState {
  const candidates = [
    usablePublicDescriptionText(program.description),
    usablePublicDescriptionText(program.summary),
  ].filter(Boolean);
  if (candidates.length === 0) return 'missing';
  if (candidates.some((text) => wordCount(text) >= MIN_PROGRAM_PUBLIC_DESCRIPTION_WORDS)) {
    return 'present';
  }
  return 'thin';
}

const overrideTier = (record: Record<string, any>): StudentVisibilityTier | null => {
  const tier = record.studentVisibilityOverrideTier;
  if (
    tier === 'student_ready' ||
    tier === 'limited_but_safe' ||
    tier === 'operator_review' ||
    tier === 'suppressed'
  ) {
    return tier;
  }
  return null;
};

const withOverride = (
  record: Record<string, any>,
  computedTier: StudentVisibilityTier,
  reasons: string[],
): StudentVisibilityResult => {
  const override = overrideTier(record);
  if (!override) {
    return { tier: computedTier, computedTier, reasons };
  }

  return {
    tier: override,
    computedTier,
    reasons: Array.from(new Set([...reasons, 'operator_override'])),
  };
};

export const BLANK_PUBLIC_DESCRIPTION_REASON = 'blank_public_description';

const PUBLIC_DESCRIPTION_INVARIANT_FIELDS = [
  'fullDescription',
  'shortDescription',
  'description',
  'summary',
] as const;

// A "Studies <A>, <B>, and <C>." sentence that only re-lists the record's own
// research-area chips is blanked at serve time as redundant chrome
// (`sanitizeServedResearchEntityCopyFields`/#1466/#1532), so it is not usable
// public prose here either: a card whose only description fields are such
// echoes renders with no sentence beside the chips it merely repeats. Treating
// it as usable let the gate promote a chips-only ghost card the serve DTO
// blanks, inconsistent with every other served `student_ready` card (#1547
// serve/quality unification). Only the free-text research fields carry this
// template; program `description`/`summary` are unaffected.
const isStudiesResearchAreaEchoField = (record: Record<string, any>, field: string): boolean => {
  if (field !== 'fullDescription' && field !== 'shortDescription') return false;
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) return false;
  return (
    isStudiesResearchAreaEchoDescription(value, record.researchAreas) ||
    isStudiesResearchAreaEchoDescription(value, record.profileResearchAreas)
  );
};

export function recordHasNoUsablePublicDescription(record: Record<string, any>): boolean {
  return !PUBLIC_DESCRIPTION_INVARIANT_FIELDS.some(
    (field) =>
      usablePublicDescriptionText(record[field]) && !isStudiesResearchAreaEchoField(record, field),
  );
}

// The single hard floor beneath every student-visibility path: a record with no
// usable public description at all can never be promoted to `student_ready` - the
// only publicly-served tier - even when an explicit operator override is forcing
// it there. An override may force past softer gates (thin copy, missing card
// shape, formalization-only, audience), but it must never publish a full card
// that would render with literally no prose. This is the exact class of defect
// fixed for programs in issue #1425, and it is enforced here - the shared choke
// point every compute path returns through - so it holds for computed promotions,
// stale overrides, and future callers alike, regardless of source. `limited_but_safe`
// is intentionally not guarded: a routed program with a source and apply link is a
// valid limited card without prose.
export function enforceStudentReadyDescriptionInvariant(
  result: StudentVisibilityResult,
  record: Record<string, any>,
): StudentVisibilityResult {
  if (result.tier !== 'student_ready') return result;
  if (!recordHasNoUsablePublicDescription(record)) return result;
  return {
    tier: 'operator_review',
    computedTier: result.computedTier,
    reasons: Array.from(new Set([...result.reasons, BLANK_PUBLIC_DESCRIPTION_REASON])),
  };
}

// The canonical hard-vs-soft reason taxonomy for `student_ready` (issue #1802).
// This constant IS the definition; the human-readable mirror is
// docs/student-ready-definition.md. Classify a reason in one place, here.
//
// SOFT / non-blocking enrichment signals. Reach-out to the professor is the
// universal next step (docs/product-context.md), so the absence of any of these
// makes a card less enriched, never wrong: they enrich ranking and badges and
// may hide their own optional sub-payload, but they NEVER gate `student_ready`
// and are never repair blockers - even the `missing_*` ones that would otherwise
// be swept up by the structural `missing_`/`_only` blocker rule.
// `missing_source_url`/`missing_official_source` are here deliberately: every
// discovered entity carries its source in observation provenance
// (`fieldProvenance[*].sourceUrl` / observations' `sourceUrl`), so a bare
// `entity.sourceUrls` is a PROJECTION GAP - closed at write time by the
// materializer - never a genuinely source-less entity.
export const STUDENT_READY_SOFT_SIGNAL_REASONS: ReadonlySet<string> = new Set([
  'source_backed_description',
  'concrete_next_step',
  'missing_action_evidence',
  'missing_facet_signal',
  'missing_alternate_access_path',
  'missing_application_route',
  'missing_source_route',
  'missing_source_url',
  'missing_official_source',
]);

export const isStudentReadySoftSignalReason = (reason: string): boolean =>
  STUDENT_READY_SOFT_SIGNAL_REASONS.has(reason);

// HARD blockers: genuine correctness/quality failures that would MISLEAD a
// student, so any one holds a card out of `student_ready`. Grouped by the
// correctness category each belongs to. The structural suppression shells
// (generic directory / biography / non-owner-grant) are removed one tier earlier
// at `suppressed`; they appear here so the repair histogram classifies them as
// blockers wherever they surface.
export const STUDENT_READY_HARD_BLOCKER_REASONS: ReadonlySet<string> = new Set([
  'missing_description',
  'missing_card_description',
  'thin_description',
  'blank_public_description',
  'missing_lead',
  'duplicate_name_risk',
  'duplicate_risk',
  'exact_url_duplicate_risk',
  'pi_identity_conflict',
  'profile_identity_risk',
  'generic_directory_shell',
  'profile_biography_shell',
  'content_page_risk',
  'non_research_entity',
  'non_research_program',
  'research_infrastructure_only',
  'non_owner_grant_shell',
  'lab_name_org_type_mismatch',
  'inactive_at_yale',
  'archive_review',
  'not_undergraduate_relevant',
]);

export const isStudentReadyHardBlockerReason = (reason: string): boolean =>
  STUDENT_READY_HARD_BLOCKER_REASONS.has(reason);

/**
 * The correctness facts that decide `student_ready`. Each field is a HARD
 * blocker category from the canonical definition (docs/student-ready-definition.md):
 * every field must be `true` for a card to be `student_ready`. Enrichment
 * signals are deliberately absent - they are soft and never appear here, so
 * source-backing, action evidence, facet signal, and access-path/source-url
 * projection never gate.
 */
export interface ResearchEntityStudentReadyCorrectness {
  // (a) A real, coherent, non-boilerplate description that renders a complete,
  // self-referential card (public-description invariant passes and the card is
  // not sparse). Incoherent, boilerplate, or serve-time-blank copy fails here.
  descriptionCoherent: boolean;
  // (a') The card's title, type, and body describe THIS entity, not a different
  // one (e.g. a "<Person> Lab" name typed as an org whose body is about a center).
  entityContentMatchesCard: boolean;
  // (b) The right person/lead is attached: a lead-requiring entity has a
  // resolved lead, with no identity conflict or wrong-person mis-attribution.
  rightLeadAttached: boolean;
  // (c) Not a duplicate of an already-known entity. Suppressed shells (generic
  // directory / biography / non-owner grant / off-scope) are removed one tier
  // earlier, at `suppressed`.
  notDuplicate: boolean;
}

/**
 * THE definition of `student_ready`, in one place: an entity is `student_ready`
 * IFF what we show is CORRECT and COHERENT - a real coherent non-boilerplate
 * description about THIS entity, the right active lead/identity, and not a
 * duplicate/shell. Enrichment (next step, action evidence, facet signal,
 * source-backing, alternate access path, source-url projection) never gates -
 * the student can always reach out to the professor. See
 * docs/student-ready-definition.md. Change the gate here, not in scattered
 * conditionals.
 */
export function researchEntityMeetsStudentReadyDefinition(
  correctness: ResearchEntityStudentReadyCorrectness,
): boolean {
  return (
    correctness.descriptionCoherent &&
    correctness.entityContentMatchesCard &&
    correctness.rightLeadAttached &&
    correctness.notDuplicate
  );
}

export function computeResearchEntityStudentVisibility({
  entity,
  leadMembers = [],
  accessSignalCount = 0,
  actionablePathwayCount = 0,
  openPostedOpportunityCount = 0,
  duplicateRisk = false,
  exactUrlDuplicateRisk = false,
  contentPageRisk = false,
  relatedEntityAccessPathCount = 0,
}: ResearchEntityStudentVisibilityInput): StudentVisibilityResult {
  const publicDescription = buildResearchEntityPublicDescriptionRepresentation({
    entity,
    leadMembers,
  });
  const quality = buildResearchEntityQualitySummary({ entity, leadMembers });
  const reasons: string[] = [];
  const hasActionEvidence =
    openPostedOpportunityCount > 0 || accessSignalCount > 0 || actionablePathwayCount > 0;
  const organizationalLeadExempt =
    isProgramLikeResearchEntity(entity) || isOrganizationalResearchEntity(entity);
  const requiresLead = !organizationalLeadExempt;
  const missingRequiredLead = requiresLead && quality.leadState !== 'lead_attached';
  // The org/program lead exemption assumes the entity itself is an alternate
  // "way in" via its own page and programs. That premise only holds when the
  // entity actually surfaces a reachable next step: a linked related/affiliated
  // research entity, or a discovered people/staff/get-involved/programs page. An
  // exempted entity with no lead and no such path is a dead end whose only
  // access signal is a generic templated CTA, so it must not be auto-published
  // to students (issue #1359).
  const organizationalDeadEnd =
    organizationalLeadExempt &&
    quality.leadState !== 'lead_attached' &&
    !hasOrganizationalAlternateAccessPath({ entity, relatedEntityAccessPathCount });
  const genericDirectoryShell =
    isGenericDirectoryOnlyProfileAreaShell(entity) &&
    quality.descriptionState === 'missing' &&
    quality.leadState !== 'lead_attached' &&
    !hasUsefulResearchAreas(entity) &&
    !hasActionEvidence;
  const profileBiographyShell = isProfileBiographyShell({
    entity,
    leadState: quality.leadState,
    descriptionState: quality.descriptionState,
    hasActionEvidence,
  });
  const nonOwnerGrantShell = isNonOwnerGrantShell({ entity, leadMembers, hasActionEvidence });
  const labNameOrgTypeMismatch = isLabNameOrgTypeMismatch(entity);
  const missingFacetSignal = missingFacultyResearchAreaFacetSignal(entity);
  const profileIdentityRisk = detectProfileIdentityRisk({ entity, leadMembers });
  const researchScope = classifyResearchEntityResearchScope(entity);
  const outsideResearchScope = !researchScope.researchHomeEligible;

  if (entity.activeAtYaleCache === false) reasons.push('inactive_at_yale');
  if (outsideResearchScope) reasons.push('non_research_entity', ...researchScope.reasons);
  if (
    textValue(entity.studentVisibilitySuppressionReason).includes('research_infrastructure_only')
  ) {
    reasons.push('research_infrastructure_only');
  }
  if (exactUrlDuplicateRisk) reasons.push('exact_url_duplicate_risk');
  if (duplicateRisk || exactUrlDuplicateRisk) reasons.push('duplicate_risk');
  if (contentPageRisk) reasons.push('content_page_risk');
  if (quality.descriptionState === 'source_backed') reasons.push('source_backed_description');
  if (quality.descriptionState === 'profile_synthesis') reasons.push('profile_fallback_only');
  if (quality.descriptionState === 'thin') reasons.push('thin_description');
  if (quality.descriptionState === 'missing') reasons.push('missing_description');
  if (quality.repairFlags.includes('missing_card_description'))
    reasons.push('missing_card_description');
  if (quality.repairFlags.includes('pi_identity_conflict')) reasons.push('pi_identity_conflict');
  if (profileIdentityRisk) reasons.push('profile_identity_risk');
  if (requiresLead && quality.leadState !== 'lead_attached') reasons.push('missing_lead');
  if (organizationalDeadEnd) reasons.push('missing_alternate_access_path');
  if (quality.repairFlags.includes('missing_source_url')) reasons.push('missing_source_url');
  if (genericDirectoryShell) reasons.push('generic_directory_shell');
  if (profileBiographyShell) reasons.push('profile_biography_shell');
  if (nonOwnerGrantShell) reasons.push('non_owner_grant_shell');
  if (labNameOrgTypeMismatch) reasons.push('lab_name_org_type_mismatch');
  if (missingFacetSignal) reasons.push('missing_facet_signal');

  if (hasActionEvidence) reasons.push('concrete_next_step');
  else reasons.push('missing_action_evidence');

  // The single source of truth for `student_ready` correctness (issue #1802).
  // Every hard-blocker category is one field; enrichment signals never appear.
  // Edit the definition in `researchEntityMeetsStudentReadyDefinition`.
  // `descriptionCoherent` (invariant.pass + complete card) already implies a
  // useful, source-backed description, so source-backing is not a separate gate.
  // A missing source url / alternate access path never gates: it is a soft
  // enrichment signal (a projection gap the materializer closes), and reach-out
  // to the professor is the universal next step.
  const studentReadyCorrectness: ResearchEntityStudentReadyCorrectness = {
    descriptionCoherent: publicDescription.invariant.pass && quality.cardState === 'complete',
    entityContentMatchesCard: !labNameOrgTypeMismatch,
    rightLeadAttached:
      (!requiresLead || quality.leadState === 'lead_attached') &&
      !quality.repairFlags.includes('pi_identity_conflict') &&
      !profileIdentityRisk,
    notDuplicate: !duplicateRisk,
  };

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (
    entity.activeAtYaleCache === false ||
    outsideResearchScope ||
    contentPageRisk ||
    exactUrlDuplicateRisk ||
    genericDirectoryShell ||
    profileBiographyShell ||
    nonOwnerGrantShell ||
    reasons.includes('research_infrastructure_only')
  ) {
    computedTier = 'suppressed';
  } else if (researchEntityMeetsStudentReadyDefinition(studentReadyCorrectness)) {
    computedTier = 'student_ready';
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.cardState === 'complete' &&
    (!requiresLead || quality.leadState === 'lead_attached') &&
    !organizationalDeadEnd &&
    !quality.repairFlags.includes('pi_identity_conflict') &&
    !profileIdentityRisk &&
    !quality.repairFlags.includes('missing_source_url') &&
    !labNameOrgTypeMismatch &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  }

  const result = outsideResearchScope
    ? { tier: computedTier, computedTier, reasons: Array.from(new Set(reasons)) }
    : withOverride(entity, computedTier, Array.from(new Set(reasons)));
  if (result.tier === 'student_ready' && !publicDescription.invariant.pass) {
    return {
      tier: result.computedTier,
      computedTier: result.computedTier,
      reasons: Array.from(new Set([...result.reasons, 'public_description_invariant_failed'])),
    };
  }
  // A lead-requiring entity with no attached PI can never be published to
  // students, even by an explicit operator override: absent a verified lead we
  // cannot vouch for the entity's identity, so it is held for review rather
  // than trusted to a manual override.
  if (
    missingRequiredLead &&
    (result.tier === 'student_ready' || result.tier === 'limited_but_safe')
  ) {
    return {
      tier: 'operator_review',
      computedTier: result.computedTier,
      reasons: Array.from(new Set([...result.reasons, 'missing_lead'])),
    };
  }
  // A contested-identity entity mixes different people's identities, so it can
  // never be published to students, even by an explicit operator override: we
  // cannot vouch for whose lab it is until the identity conflict is resolved.
  if (
    profileIdentityRisk &&
    (result.tier === 'student_ready' || result.tier === 'limited_but_safe')
  ) {
    return {
      tier: 'operator_review',
      computedTier: result.computedTier,
      reasons: Array.from(new Set([...result.reasons, 'profile_identity_risk'])),
    };
  }
  return enforceStudentReadyDescriptionInvariant(result, entity);
}

export function computeProgramStudentVisibility(
  program: ProgramStudentVisibilityInput,
): StudentVisibilityResult {
  const reasons: string[] = [];
  const title = textValue(program.title);
  const category = textValue(program.studentFacingCategory);
  const sourceUrl = textValue(program.sourceUrl);
  const routeUrls = [
    program.applicationLink,
    ...(Array.isArray(program.links) ? program.links.map((link) => link?.url) : []),
  ];
  const sourceUrls = [sourceUrl, ...routeUrls];
  const hasOfficialSource = hasHttpUrl(sourceUrl);
  const hasApplicationRoute = hasAnyHttpUrl(routeUrls);
  const sourceIsApplicationPortal =
    /^https:\/\/yale\.communityforce\.com\/Funds\/FundDetails\.aspx\?/i.test(sourceUrl);
  const isArchiveReview = category === 'Archive / review';
  const graduateOnly = program.undergraduateOnly === false;
  const undergraduateRelevant =
    program.undergraduateOnly === true || program.yaleCollegeOnly === true;
  const audienceKnown = undergraduateRelevant || graduateOnly;
  const formalizationOnly = isFormalizationOnlyProgram(program);
  const researchRelated = classifyProgramResearchRelevance(program).researchRelated;
  const descriptionState = programPublicDescriptionState(program);
  const catalogOrAdmin =
    /\b(administering|alternative funding|find funding|student grants database|faculty staff)\b/i.test(
      title,
    );

  if (hasOfficialSource) reasons.push('official_source');
  else reasons.push('missing_official_source');
  if (sourceIsApplicationPortal) reasons.push('application_source_only');
  if (hasApplicationRoute) reasons.push('application_route');
  else reasons.push('missing_application_route');
  if (isArchiveReview) reasons.push('archive_review');
  if (catalogOrAdmin) reasons.push('not_undergraduate_relevant');
  if (undergraduateRelevant) reasons.push('undergraduate_relevant');
  if (graduateOnly) reasons.push('graduate_relevant');
  if (formalizationOnly) reasons.push('formalization_only');
  if (descriptionState === 'missing') reasons.push('missing_description');
  else if (descriptionState === 'thin') reasons.push('thin_description');
  if (!researchRelated) reasons.push('non_research_program');

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (catalogOrAdmin || !researchRelated) {
    computedTier = 'suppressed';
  } else if (
    !isArchiveReview &&
    audienceKnown &&
    hasOfficialSource &&
    hasApplicationRoute &&
    !sourceIsApplicationPortal
  ) {
    // A research program with a known audience, a real (non-portal) official source, and an
    // application route is student-ready regardless of whether that audience is undergraduate
    // or graduate: on a research-discovery surface, audience is an honest label (surfaced as a
    // Graduate badge for graduate-only records), not a suppression trigger. Only catalog/admin
    // pages and non-research records stay suppressed. The `formalization_only` reason is still
    // recorded for transparency but no longer caps tier. A student-facing public description is
    // required before student_ready: without a non-thin summary or description the card would
    // render with no explanatory prose, so a description-less record is capped at limited_but_safe
    // (mirroring the research-entity public-description invariant that gates the same tier).
    computedTier = descriptionState === 'present' ? 'student_ready' : 'limited_but_safe';
  } else if (!isArchiveReview && audienceKnown && hasOfficialSource) {
    computedTier = 'limited_but_safe';
  }

  if (!hasAnyHttpUrl(sourceUrls)) reasons.push('missing_source_route');

  return enforceStudentReadyDescriptionInvariant(
    withOverride(program, computedTier, Array.from(new Set(reasons))),
    program,
  );
}
