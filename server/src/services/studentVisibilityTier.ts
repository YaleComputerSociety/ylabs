import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import { isProfileAreaShellEntity } from '../utils/profileAreaDuplicateRisk';
import { buildResearchEntityQualitySummary } from './researchEntityQuality';
import { classifyProgramResearchRelevance } from './programResearchRelevance';

export const STUDENT_VISIBILITY_VERSION = 'student-visibility-v1';

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
  return Array.isArray(entity.researchAreas) && entity.researchAreas.some((area) => textValue(area));
}

function isProgramLikeResearchEntity(entity: Record<string, any>): boolean {
  return (
    textValue(entity.kind).toLowerCase() === 'program' ||
    textValue(entity.entityType).toUpperCase() === 'PROGRAM'
  );
}

const ORGANIZATIONAL_ENTITY_TYPES = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
]);

/**
 * Organizational research homes (centers, institutes, initiatives, core
 * facilities) are institutionally contactable: the entity itself — via its
 * official page and programs — is the way in, so a single named individual lead
 * is NOT required for student visibility. (Many real Yale centers are dean- or
 * committee-led and never publish a single "director".) A named director is
 * still surfaced when known, but its absence should not hide a well-described,
 * source-backed center from students.
 */
function isOrganizationalResearchEntity(entity: Record<string, any>): boolean {
  return ORGANIZATIONAL_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase());
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
      host === 'orcid.org'
    );
  } catch {
    return false;
  }
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
  if (entryMode === 'SECURE_MENTOR_THEN_APPLY' || program.requiresMentorBeforeApply === true) return true;
  return formalizationCategoryPattern.test(category);
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

export const isPublicStudentVisibilityTier = (tier: unknown): tier is StudentVisibilityTier =>
  publicStudentVisibilityTiers.includes(tier as StudentVisibilityTier);

export function computeResearchEntityStudentVisibility({
  entity,
  leadMembers = [],
  accessSignalCount = 0,
  actionablePathwayCount = 0,
  openPostedOpportunityCount = 0,
  duplicateRisk = false,
  exactUrlDuplicateRisk = false,
  contentPageRisk = false,
}: ResearchEntityStudentVisibilityInput): StudentVisibilityResult {
  const quality = buildResearchEntityQualitySummary({ entity, leadMembers });
  const reasons: string[] = [];
  const hasActionEvidence =
    openPostedOpportunityCount > 0 || accessSignalCount > 0 || actionablePathwayCount > 0;
  const requiresLead =
    !isProgramLikeResearchEntity(entity) && !isOrganizationalResearchEntity(entity);
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

  if (entity.activeAtYaleCache === false) reasons.push('inactive_at_yale');
  if (textValue(entity.studentVisibilitySuppressionReason).includes('research_infrastructure_only')) {
    reasons.push('research_infrastructure_only');
  }
  if (exactUrlDuplicateRisk) reasons.push('exact_url_duplicate_risk');
  if (duplicateRisk || exactUrlDuplicateRisk) reasons.push('duplicate_risk');
  if (contentPageRisk) reasons.push('content_page_risk');
  if (quality.descriptionState === 'source_backed') reasons.push('source_backed_description');
  if (quality.descriptionState === 'profile_synthesis') reasons.push('profile_fallback_only');
  if (quality.descriptionState === 'thin') reasons.push('thin_description');
  if (quality.descriptionState === 'missing') reasons.push('missing_description');
  if (quality.repairFlags.includes('missing_card_description')) reasons.push('missing_card_description');
  if (quality.repairFlags.includes('pi_identity_conflict')) reasons.push('pi_identity_conflict');
  if (requiresLead && quality.leadState !== 'lead_attached') reasons.push('missing_lead');
  if (quality.repairFlags.includes('missing_source_url')) reasons.push('missing_source_url');
  if (genericDirectoryShell) reasons.push('generic_directory_shell');
  if (profileBiographyShell) reasons.push('profile_biography_shell');
  if (nonOwnerGrantShell) reasons.push('non_owner_grant_shell');

  if (hasActionEvidence) reasons.push('concrete_next_step');
  else reasons.push('missing_action_evidence');

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (
    entity.activeAtYaleCache === false ||
    contentPageRisk ||
    exactUrlDuplicateRisk ||
    genericDirectoryShell ||
    profileBiographyShell ||
    nonOwnerGrantShell ||
    reasons.includes('research_infrastructure_only')
  ) {
    computedTier = 'suppressed';
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.cardState === 'complete' &&
    (!requiresLead || quality.leadState === 'lead_attached') &&
    !quality.repairFlags.includes('pi_identity_conflict') &&
    !quality.repairFlags.includes('missing_source_url') &&
    hasActionEvidence &&
    !duplicateRisk
  ) {
    computedTier = 'student_ready';
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.cardState === 'complete' &&
    (!requiresLead || quality.leadState === 'lead_attached') &&
    !quality.repairFlags.includes('pi_identity_conflict') &&
    !quality.repairFlags.includes('missing_source_url') &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  }

  return withOverride(entity, computedTier, Array.from(new Set(reasons)));
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
  const sourceIsApplicationPortal = /^https:\/\/yale\.communityforce\.com\/Funds\/FundDetails\.aspx\?/i.test(
    sourceUrl,
  );
  const isArchiveReview = category === 'Archive / review';
  const graduateOnly = program.undergraduateOnly === false;
  const formalizationOnly = isFormalizationOnlyProgram(program);
  const researchRelated = classifyProgramResearchRelevance(program).researchRelated;
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
  if (graduateOnly || catalogOrAdmin) reasons.push('not_undergraduate_relevant');
  const undergraduateRelevant = program.undergraduateOnly === true || program.yaleCollegeOnly === true;
  if (undergraduateRelevant) {
    reasons.push('undergraduate_relevant');
  }
  if (formalizationOnly) reasons.push('formalization_only');
  if (!researchRelated) reasons.push('non_research_program');

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (graduateOnly || catalogOrAdmin || !researchRelated) {
    computedTier = 'suppressed';
  } else if (
    !isArchiveReview &&
    undergraduateRelevant &&
    hasOfficialSource &&
    hasApplicationRoute &&
    !sourceIsApplicationPortal
  ) {
    // Undergraduate-relevant research programs with a real (non-portal) official source and
    // an application route are student-ready. This includes research funding (senior thesis,
    // research travel, fellowship funding): on a research-focused surface, undergrad research
    // funding is a destination students should see, not a hidden formalization step. The
    // `formalization_only` reason is still recorded for transparency but no longer caps tier.
    computedTier = 'student_ready';
  } else if (!isArchiveReview && undergraduateRelevant && hasOfficialSource) {
    computedTier = 'limited_but_safe';
  }

  if (!hasAnyHttpUrl(sourceUrls)) reasons.push('missing_source_route');

  return withOverride(program, computedTier, Array.from(new Set(reasons)));
}
