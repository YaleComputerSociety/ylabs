/**
 * Pure logic for the canonical reference-integrity audit (#210 Phase 6, #727).
 *
 * A dangling ObjectId reference is a valid bson ObjectId, so it never violates
 * a collection's `$jsonSchema` and is therefore invisible to the strict-flip
 * readiness audit (`canonicalValidatorStrictReadinessAuditCore.ts`). This audit
 * covers the other half of the safety gate: it counts references that point at
 * a document that no longer exists, plus required references that are missing.
 *
 * The edge list is declarative on purpose. It reuses the reference-audit
 * primitives already proven in `betaDataQualityCore.ts` (summary shaping and
 * orphan/missing sample pipelines) rather than re-deriving them, so the two
 * audits stay consistent.
 */
import {
  buildReferenceIntegritySummary,
  type ReferenceAuditInput,
  type ReferenceIntegritySummary,
} from './betaDataQualityCore';

export interface CanonicalReferenceEdge {
  name: string;
  collectionName: string;
  localField: string;
  targetCollectionName: string;
  required: boolean;
  isArray: boolean;
  ownerFilter?: Readonly<Record<string, unknown>>;
}

export const CANONICAL_REFERENCE_EDGES: readonly CanonicalReferenceEdge[] = Object.freeze([
  {
    name: 'role_assignments.personId -> researchers',
    collectionName: 'role_assignments',
    localField: 'personId',
    targetCollectionName: 'researchers',
    required: true,
    isArray: false,
  },
  {
    name: 'role_assignments.target.id -> research_entities',
    collectionName: 'role_assignments',
    localField: 'target.id',
    targetCollectionName: 'research_entities',
    required: true,
    isArray: false,
    ownerFilter: { 'target.kind': 'RESEARCH_ENTITY' },
  },
  {
    name: 'role_assignments.target.id -> org_units',
    collectionName: 'role_assignments',
    localField: 'target.id',
    targetCollectionName: 'org_units',
    required: true,
    isArray: false,
    ownerFilter: { 'target.kind': 'ORG_UNIT' },
  },
  {
    name: 'role_assignments.evidenceClaimIds -> evidence_claims',
    collectionName: 'role_assignments',
    localField: 'evidenceClaimIds',
    targetCollectionName: 'evidence_claims',
    required: false,
    isArray: true,
  },
  {
    name: 'signals.researchEntityId -> research_entities',
    collectionName: 'signals',
    localField: 'researchEntityId',
    targetCollectionName: 'research_entities',
    required: true,
    isArray: false,
  },
  {
    name: 'signals.source.evidenceIds -> observations',
    collectionName: 'signals',
    localField: 'source.evidenceIds',
    targetCollectionName: 'observations',
    required: false,
    isArray: true,
  },
  {
    name: 'research_entity_relationships.sourceResearchEntityId -> research_entities',
    collectionName: 'research_entity_relationships',
    localField: 'sourceResearchEntityId',
    targetCollectionName: 'research_entities',
    required: true,
    isArray: false,
  },
  {
    name: 'research_entity_relationships.targetResearchEntityId -> research_entities',
    collectionName: 'research_entity_relationships',
    localField: 'targetResearchEntityId',
    targetCollectionName: 'research_entities',
    required: true,
    isArray: false,
  },
  {
    name: 'researchers.accountId -> accounts',
    collectionName: 'researchers',
    localField: 'accountId',
    targetCollectionName: 'accounts',
    required: false,
    isArray: false,
  },
  {
    name: 'research_plans.accountId -> accounts',
    collectionName: 'research_plans',
    localField: 'accountId',
    targetCollectionName: 'accounts',
    required: true,
    isArray: false,
  },
  {
    name: 'org_units.parentOrgUnitId -> org_units',
    collectionName: 'org_units',
    localField: 'parentOrgUnitId',
    targetCollectionName: 'org_units',
    required: false,
    isArray: false,
  },
]);

export interface CanonicalReferenceIntegritySummary {
  edgesChecked: number;
  hardFailureTotal: number;
  missingRequiredTotal: number;
  orphanedPresentRefTotal: number;
  edgesWithFailures: string[];
  clean: boolean;
}

export interface CanonicalReferenceIntegrityReport {
  generatedAt: string;
  environment: string;
  databaseName: string;
  mode: 'read-only';
  summary: CanonicalReferenceIntegritySummary;
  edges: ReferenceIntegritySummary['items'];
}

export function buildCanonicalReferenceIntegrityReport(input: {
  environment: string;
  databaseName: string;
  inputs: readonly ReferenceAuditInput[];
  generatedAt?: string;
}): CanonicalReferenceIntegrityReport {
  const referenceSummary = buildReferenceIntegritySummary([...input.inputs]);
  const edgesWithFailures = referenceSummary.items
    .filter((item) => item.failureCount > 0)
    .map((item) => item.name);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    environment: input.environment,
    databaseName: input.databaseName,
    mode: 'read-only',
    summary: {
      edgesChecked: referenceSummary.items.length,
      hardFailureTotal: referenceSummary.hardFailureTotal,
      missingRequiredTotal: referenceSummary.missingRequiredTotal,
      orphanedPresentRefTotal: referenceSummary.orphanedPresentRefTotal,
      edgesWithFailures,
      clean: referenceSummary.hardFailureTotal === 0,
    },
    edges: referenceSummary.items,
  };
}

export interface CanonicalReferenceIntegrityArgs {
  environment: 'development' | 'beta' | 'production-copy' | 'production' | 'test';
  sampleLimit: number;
  includeSamples: boolean;
  output?: string;
}

export function parseCanonicalReferenceIntegrityArgs(
  argv: string[],
): CanonicalReferenceIntegrityArgs {
  let environment: CanonicalReferenceIntegrityArgs['environment'] | undefined;
  let sampleLimit = 10;
  let includeSamples = false;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--environment') {
      const raw = argv[index + 1];
      if (
        raw !== 'development' &&
        raw !== 'beta' &&
        raw !== 'production-copy' &&
        raw !== 'production' &&
        raw !== 'test'
      ) {
        throw new Error(
          '--environment requires development, beta, production-copy, production, or test',
        );
      }
      environment = raw;
      index += 1;
    } else if (arg === '--sample-limit') {
      const raw = argv[index + 1];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('--sample-limit requires a non-negative number');
      }
      sampleLimit = Math.floor(parsed);
      index += 1;
    } else if (arg === '--include-samples') {
      includeSamples = true;
    } else if (arg === '--output') {
      const raw = argv[index + 1];
      if (!raw) throw new Error('--output requires a path');
      output = raw;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment) {
    throw new Error('--environment is required');
  }

  return { environment, sampleLimit, includeSamples, output };
}
