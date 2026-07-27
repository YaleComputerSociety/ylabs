export const EVIDENCE_PREDICATE_REGISTRY_VERSION = 1 as const;

export const evidenceClaimSubjectKinds = [
  'PERSON',
  'ROLE_ASSIGNMENT',
  'RESEARCH_ENTITY',
  'ENTITY_RELATIONSHIP',
  'ENTRY_PATHWAY',
  'POSTED_OPPORTUNITY',
] as const;

export type EvidenceClaimSubjectKind = (typeof evidenceClaimSubjectKinds)[number];

export interface EvidencePredicateDefinition {
  registryVersion: typeof EVIDENCE_PREDICATE_REGISTRY_VERSION;
  allowedSubjectKinds: readonly EvidenceClaimSubjectKind[];
  description: string;
}

function definePredicate(
  allowedSubjectKinds: readonly EvidenceClaimSubjectKind[],
  description: string,
): EvidencePredicateDefinition {
  return Object.freeze({
    registryVersion: EVIDENCE_PREDICATE_REGISTRY_VERSION,
    allowedSubjectKinds: Object.freeze([...allowedSubjectKinds]),
    description,
  });
}

export const evidencePredicateRegistry = Object.freeze({
  PERSON_HAS_OFFICIAL_PROFILE: definePredicate(
    ['PERSON'],
    'A Yale-confirmed person has a source-backed official profile.',
  ),
  PERSON_HAS_ORCID: definePredicate(
    ['PERSON'],
    'A Yale-confirmed person has a source-backed ORCID identifier.',
  ),
  PERSON_LEADS_ENTITY: definePredicate(
    ['PERSON', 'ROLE_ASSIGNMENT'],
    'A person leads a research entity through an evidenced role.',
  ),
  ENTITY_HAS_DESCRIPTION: definePredicate(
    ['RESEARCH_ENTITY'],
    'A source provides descriptive research-home content.',
  ),
  ENTITY_USES_METHOD: definePredicate(
    ['RESEARCH_ENTITY'],
    'A source states that a research entity uses a method.',
  ),
  UNDERGRAD_PARTICIPATION_OBSERVED: definePredicate(
    ['RESEARCH_ENTITY', 'ROLE_ASSIGNMENT'],
    'A source records current or historical undergraduate participation.',
  ),
  OFFICIAL_APPLICATION_EXISTS: definePredicate(
    ['RESEARCH_ENTITY', 'ENTRY_PATHWAY', 'POSTED_OPPORTUNITY'],
    'A source identifies an official application route.',
  ),
  OPPORTUNITY_HAS_DEADLINE: definePredicate(
    ['POSTED_OPPORTUNITY'],
    'A source states a deadline for a posted opportunity.',
  ),
  DIRECT_CONTACT_NOT_PERMITTED: definePredicate(
    ['PERSON', 'RESEARCH_ENTITY', 'ENTRY_PATHWAY'],
    'A source explicitly states that direct contact is not permitted.',
  ),
});

export type EvidenceClaimPredicate = keyof typeof evidencePredicateRegistry;

export const evidenceClaimPredicates = Object.freeze(
  Object.keys(evidencePredicateRegistry) as EvidenceClaimPredicate[],
);

export function isEvidenceClaimPredicate(value: unknown): value is EvidenceClaimPredicate {
  return typeof value === 'string' && Object.hasOwn(evidencePredicateRegistry, value);
}

export function evidencePredicateSupportsSubject(
  predicate: EvidenceClaimPredicate,
  subjectKind: EvidenceClaimSubjectKind,
): boolean {
  return evidencePredicateRegistry[predicate].allowedSubjectKinds.includes(subjectKind);
}
