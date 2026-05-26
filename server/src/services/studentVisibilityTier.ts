import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import { buildResearchEntityQualitySummary } from './researchEntityQuality';

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
  accessSignalTypes?: string[];
  actionablePathwayCount?: number;
  actionablePathwayTypes?: string[];
  publicContactRouteCount?: number;
  publicContactRouteTypes?: string[];
  openPostedOpportunityCount?: number;
  duplicateRisk?: boolean;
  contentPageRisk?: boolean;
}

export interface ProgramStudentVisibilityInput extends Record<string, any> {
  title?: string;
  studentFacingCategory?: string;
  sourceUrl?: string;
  applicationLink?: string;
  links?: Array<{ url?: string }>;
  undergraduateOnly?: boolean;
  yaleCollegeOnly?: boolean;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const hasAnyHttpUrl = (values: unknown[]): boolean => values.some(hasHttpUrl);

const LAB_LEAD_ROLES = new Set(['pi', 'co-pi', 'core-faculty']);
const FACULTY_LEAD_ROLES = new Set(['pi', 'co-pi', 'core-faculty']);
const CENTER_LEAD_ROLES = new Set(['director', 'co-director', 'program-manager']);
const EXPLORATORY_PATHWAY_TYPES = new Set(['EXPLORATORY_CONTACT', 'FACULTY_SUPERVISION']);
const EXPLORATORY_ACCESS_SIGNAL_TYPES = new Set([
  'REACH_OUT_PLAUSIBLE',
  'FACULTY_SUPERVISES_STUDENT_PROJECTS',
]);
const CENTER_ACTION_PATHWAY_TYPES = new Set([
  'CENTER_INTERNSHIP',
  'RECURRING_PROGRAM',
  'POSTED_ROLE',
  'EXPLORATORY_CONTACT',
]);
const CENTER_ACTION_CONTACT_ROUTE_TYPES = new Set([
  'PROGRAM_MANAGER',
  'DEPARTMENT_CONTACT',
  'OFFICIAL_APPLICATION',
]);
const CENTER_ACTION_ACCESS_SIGNAL_TYPES = new Set([
  'POSTED_OPENING',
  'RECURRING_PROGRAM',
  'APPLICATION_FORM_EXISTS',
  'CONTACT_INSTRUCTIONS_EXIST',
  'PROGRAM_MANAGER_LISTED',
]);
const FACULTY_READY_CONTACT_ROUTE_TYPES = new Set([
  'OFFICIAL_APPLICATION',
  'LAB_MANAGER',
  'PROGRAM_MANAGER',
  'DEPARTMENT_CONTACT',
]);
const FACULTY_READY_ACCESS_SIGNAL_TYPES = new Set([
  'POSTED_OPENING',
  'RECURRING_PROGRAM',
  'APPLICATION_FORM_EXISTS',
  'CONTACT_INSTRUCTIONS_EXIST',
]);
const CENTER_LIKE_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE']);

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

const normalizedType = (value: unknown): string => textValue(value).toUpperCase();

function entityTypeFor(entity: Record<string, any>): string {
  const entityType = normalizedType(entity.entityType);
  if (entityType) return entityType;
  const kind = textValue(entity.kind).toLowerCase();
  if (kind === 'lab') return 'LAB';
  if (kind === 'center') return 'CENTER';
  if (kind === 'individual' || kind === 'solo') return 'FACULTY_RESEARCH_AREA';
  return '';
}

const hasTypedValue = (values: string[] | undefined, allowed: Set<string>): boolean =>
  (values || []).some((value) => allowed.has(normalizedType(value)));

const hasRoleBackedMember = (
  members: Array<Record<string, any>>,
  allowedRoles: Set<string>,
): boolean =>
  members.some((member) => {
    const role = textValue(member.role).toLowerCase();
    const hasIdentity = Boolean(
      member.userId || member.user?._id || textValue(member.name) || textValue(member.user?.netid),
    );
    return allowedRoles.has(role) && hasIdentity;
  });

export function computeResearchEntityStudentVisibility({
  entity,
  leadMembers = [],
  accessSignalCount = 0,
  accessSignalTypes = [],
  actionablePathwayCount = 0,
  actionablePathwayTypes = [],
  publicContactRouteCount = 0,
  publicContactRouteTypes = [],
  openPostedOpportunityCount = 0,
  duplicateRisk = false,
  contentPageRisk = false,
}: ResearchEntityStudentVisibilityInput): StudentVisibilityResult {
  const quality = buildResearchEntityQualitySummary({ entity, leadMembers });
  const entityType = entityTypeFor(entity);
  const reasons: string[] = [];

  if (entity.activeAtYaleCache === false) reasons.push('inactive_at_yale');
  if (duplicateRisk) reasons.push('duplicate_risk');
  if (contentPageRisk) reasons.push('content_page_risk');
  if (quality.descriptionState === 'source_backed') reasons.push('source_backed_description');
  if (quality.descriptionState === 'profile_synthesis') reasons.push('profile_fallback_only');
  if (quality.descriptionState === 'thin') reasons.push('thin_description');
  if (quality.descriptionState === 'missing') reasons.push('missing_description');
  if (
    quality.leadState !== 'lead_attached' &&
    !CENTER_LIKE_ENTITY_TYPES.has(entityType) &&
    entityType !== 'LAB' &&
    entityType !== 'FACULTY_RESEARCH_AREA'
  ) {
    reasons.push('missing_lead');
  }
  if (quality.repairFlags.includes('missing_source_url')) reasons.push('missing_source_url');

  const hasActionEvidence =
    openPostedOpportunityCount > 0 ||
    accessSignalCount > 0 ||
    actionablePathwayCount > 0 ||
    publicContactRouteCount > 0;
  if (hasActionEvidence) reasons.push('concrete_next_step');
  else reasons.push('missing_action_evidence');

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (entity.activeAtYaleCache === false || contentPageRisk) {
    computedTier = 'suppressed';
  } else if (CENTER_LIKE_ENTITY_TYPES.has(entityType)) {
    const hasOfficialSource = !quality.repairFlags.includes('missing_source_url');
    const hasUsefulDescription =
      quality.descriptionState === 'source_backed' || quality.descriptionState === 'thin';
    const hasCenterActionRoute =
      publicContactRouteCount > 0 ||
      openPostedOpportunityCount > 0 ||
      hasTypedValue(actionablePathwayTypes, CENTER_ACTION_PATHWAY_TYPES) ||
      hasTypedValue(publicContactRouteTypes, CENTER_ACTION_CONTACT_ROUTE_TYPES) ||
      hasTypedValue(accessSignalTypes, CENTER_ACTION_ACCESS_SIGNAL_TYPES);

    if (hasOfficialSource) reasons.push('center_official_source');
    else reasons.push('missing_center_official_source');
    if (hasRoleBackedMember(leadMembers, CENTER_LEAD_ROLES)) reasons.push('center_director_attached');
    if (hasCenterActionRoute) reasons.push('center_action_route');
    else reasons.push('center_affiliation_index', 'missing_center_contact_route');

    if (!duplicateRisk && hasOfficialSource && hasUsefulDescription && hasCenterActionRoute) {
      computedTier = 'student_ready';
    } else if (!duplicateRisk && hasOfficialSource && hasUsefulDescription) {
      computedTier = 'limited_but_safe';
    }
  } else if (entityType === 'LAB') {
    const hasLabLead = hasRoleBackedMember(leadMembers, LAB_LEAD_ROLES);
    if (hasLabLead) reasons.push('lab_pi_attached');
    else reasons.push('missing_lab_lead');

    if (
      quality.descriptionState === 'source_backed' &&
      hasLabLead &&
      !quality.repairFlags.includes('missing_source_url') &&
      hasActionEvidence &&
      !duplicateRisk
    ) {
      computedTier = 'student_ready';
    } else if (
      (quality.descriptionState === 'source_backed' || quality.descriptionState === 'thin') &&
      hasLabLead &&
      !quality.repairFlags.includes('missing_source_url') &&
      !duplicateRisk
    ) {
      computedTier = 'limited_but_safe';
    } else if (
      quality.descriptionState === 'profile_synthesis' &&
      hasLabLead &&
      !quality.repairFlags.includes('missing_source_url') &&
      hasActionEvidence &&
      !duplicateRisk
    ) {
      computedTier = 'limited_but_safe';
    }
  } else if (entityType === 'FACULTY_RESEARCH_AREA') {
    const hasFacultyIdentity = hasRoleBackedMember(leadMembers, FACULTY_LEAD_ROLES);
    const hasExploratoryFraming =
      hasTypedValue(actionablePathwayTypes, EXPLORATORY_PATHWAY_TYPES) ||
      hasTypedValue(accessSignalTypes, EXPLORATORY_ACCESS_SIGNAL_TYPES) ||
      hasTypedValue(publicContactRouteTypes, new Set(['FACULTY_PI']));
    const hasReadyAction =
      openPostedOpportunityCount > 0 ||
      hasTypedValue(publicContactRouteTypes, FACULTY_READY_CONTACT_ROUTE_TYPES) ||
      hasTypedValue(accessSignalTypes, FACULTY_READY_ACCESS_SIGNAL_TYPES);

    if (hasFacultyIdentity) reasons.push('faculty_identity_attached');
    else reasons.push('missing_faculty_identity');
    if (hasExploratoryFraming) reasons.push('exploratory_framing');
    else reasons.push('missing_exploratory_framing');

    if (
      quality.descriptionState === 'source_backed' &&
      hasFacultyIdentity &&
      !quality.repairFlags.includes('missing_source_url') &&
      hasReadyAction &&
      !duplicateRisk
    ) {
      computedTier = 'student_ready';
    } else if (
      (quality.descriptionState === 'source_backed' ||
        quality.descriptionState === 'thin' ||
        quality.descriptionState === 'profile_synthesis') &&
      hasFacultyIdentity &&
      !quality.repairFlags.includes('missing_source_url') &&
      hasExploratoryFraming &&
      !duplicateRisk
    ) {
      computedTier = 'limited_but_safe';
    }
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    hasActionEvidence &&
    !duplicateRisk
  ) {
    computedTier = 'student_ready';
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  } else if (
    quality.descriptionState === 'thin' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  } else if (
    quality.descriptionState === 'profile_synthesis' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    hasActionEvidence &&
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

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (graduateOnly || catalogOrAdmin) {
    computedTier = 'suppressed';
  } else if (
    !isArchiveReview &&
    undergraduateRelevant &&
    hasOfficialSource &&
    hasApplicationRoute &&
    !sourceIsApplicationPortal
  ) {
    computedTier = 'student_ready';
  } else if (!isArchiveReview && undergraduateRelevant && hasOfficialSource) {
    computedTier = 'limited_but_safe';
  }

  if (!hasAnyHttpUrl(sourceUrls)) reasons.push('missing_source_route');

  return withOverride(program, computedTier, Array.from(new Set(reasons)));
}
