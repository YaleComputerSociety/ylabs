/**
 * Classifies whether an organizational ResearchEntity is actually a research
 * home. Organization type and polished source copy are not sufficient by
 * themselves: service and instructional-support units need positive evidence
 * that they conduct or organize research.
 */

export interface ResearchEntityResearchScopeInput {
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
  entityType?: unknown;
  summary?: unknown;
  description?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
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
    text(entity.description),
    text(entity.shortDescription),
    text(entity.fullDescription),
  ]
    .filter(Boolean)
    .join(' ');
  const serviceOrInstructionalSupport = SERVICE_OR_INSTRUCTIONAL_SUPPORT.test(narrative);
  const positiveResearchEvidence = CONDUCTS_OR_ORGANIZES_RESEARCH.test(narrative);

  if (serviceOrInstructionalSupport && !positiveResearchEvidence) {
    return {
      researchHomeEligible: false,
      reasons: ['service_or_instructional_support', 'missing_positive_research_evidence'],
    };
  }

  return {
    researchHomeEligible: true,
    reasons: positiveResearchEvidence ? ['positive_research_evidence'] : [],
  };
}
