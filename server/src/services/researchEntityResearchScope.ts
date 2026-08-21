/**
 * Classifies whether an organizational ResearchEntity is actually a research
 * home. Organization type and polished source copy are not sufficient by
 * themselves: service, administrative, and instructional-support units need
 * positive evidence that they conduct or organize research.
 */

export interface ResearchEntityResearchScopeInput {
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
  entityType?: unknown;
  summary?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
  profileSynthesisDescription?: unknown;
  researchAreas?: unknown;
  keywords?: unknown;
}

export interface ResearchEntityResearchScopeResult {
  researchHomeEligible: boolean;
  reasons: string[];
}

const ORGANIZATIONAL_KINDS = new Set(['center', 'institute', 'initiative', 'core facility']);
const ORGANIZATIONAL_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY']);

const SERVICE_OR_INSTRUCTIONAL_SUPPORT =
  /\b(teaching and learning|teaching support|instructional support|faculty development|educational development|pedagogical support|course design|teaching consultation|teaching consultations|writing center|tutoring|academic support)\b/i;

const ADMINISTRATIVE_OR_SERVICE_ORGANIZATION =
  /\b(administrative (?:office|services|support|unit|operations)|office of administration|business operations|operations (?:office|team|unit)|human resources|career services|career advising|academic advising|advising services|student (?:services|affairs)|dean of students|office of the registrar|registrar's office|financial aid office|office of financial aid|admissions office|office of admissions|information technology services|help ?desk|technical support|facilities management|facilities services|event (?:planning|management|services)|conference services|communications office|office of communications|marketing and communications|communications and marketing|public relations|media relations|alumni relations|development office|office of development|advancement office)\b/i;

const CONDUCTS_OR_ORGANIZES_RESEARCH =
  /\b(conducts? research|research center|research institute|research initiative|research program|research programs|research project|research projects|researchers?|investigators?|laborator(?:y|ies)|fieldwork|clinical trials?|research fellows?|postdoctoral research|data collection|empirical research|scholarly research)\b/i;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function isOrganizationalEntity(entity: ResearchEntityResearchScopeInput): boolean {
  return (
    ORGANIZATIONAL_KINDS.has(text(entity.kind).toLowerCase()) ||
    ORGANIZATIONAL_ENTITY_TYPES.has(text(entity.entityType).toUpperCase())
  );
}

export function classifyResearchEntityResearchScope(
  entity: ResearchEntityResearchScopeInput,
): ResearchEntityResearchScopeResult {
  if (!isOrganizationalEntity(entity)) {
    return { researchHomeEligible: true, reasons: [] };
  }

  const narrative = [
    text(entity.name),
    text(entity.displayName),
    text(entity.summary),
    text(entity.shortDescription),
    text(entity.fullDescription),
    text(entity.profileSynthesisDescription),
  ]
    .filter(Boolean)
    .join(' ');
  const serviceOrInstructionalSupport = SERVICE_OR_INSTRUCTIONAL_SUPPORT.test(narrative);
  const administrativeOrServiceOrganization =
    ADMINISTRATIVE_OR_SERVICE_ORGANIZATION.test(narrative);
  const positiveResearchEvidence = CONDUCTS_OR_ORGANIZES_RESEARCH.test(narrative);

  const nonResearchOrganization =
    serviceOrInstructionalSupport || administrativeOrServiceOrganization;

  if (nonResearchOrganization && !positiveResearchEvidence) {
    const reasons: string[] = [];
    if (serviceOrInstructionalSupport) reasons.push('service_or_instructional_support');
    if (administrativeOrServiceOrganization) reasons.push('administrative_or_service_organization');
    reasons.push('missing_positive_research_evidence');
    return { researchHomeEligible: false, reasons };
  }

  return {
    researchHomeEligible: true,
    reasons: positiveResearchEvidence ? ['positive_research_evidence'] : [],
  };
}
