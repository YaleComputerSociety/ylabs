import { describe, expect, it } from 'vitest';
import {
  buildCanonicalReferenceIntegrityReport,
  CANONICAL_REFERENCE_EDGES,
  parseCanonicalReferenceIntegrityArgs,
} from '../canonicalReferenceIntegrityAuditCore';

const GENERATED_AT = '2026-01-01T00:00:00.000Z';

describe('CANONICAL_REFERENCE_EDGES', () => {
  it('covers the RoleAssignment, Signal, and ResearchEntityRelationship dangling-ref risks named in #727', () => {
    const names = CANONICAL_REFERENCE_EDGES.map((edge) => edge.name);
    expect(names).toContain('role_assignments.personId -> researchers');
    expect(names).toContain('role_assignments.target.id -> research_entities');
    expect(names).toContain('role_assignments.target.id -> org_units');
    expect(names).toContain('signals.researchEntityId -> research_entities');
    expect(names).toContain(
      'research_entity_relationships.sourceResearchEntityId -> research_entities',
    );
  });

  it('discriminates the polymorphic role-assignment target by kind', () => {
    const targetEdges = CANONICAL_REFERENCE_EDGES.filter(
      (edge) => edge.collectionName === 'role_assignments' && edge.localField === 'target.id',
    );
    expect(targetEdges).toHaveLength(2);
    expect(targetEdges.map((edge) => edge.ownerFilter)).toEqual([
      { 'target.kind': 'RESEARCH_ENTITY' },
      { 'target.kind': 'ORG_UNIT' },
    ]);
  });
});

describe('buildCanonicalReferenceIntegrityReport', () => {
  it('reports a clean database when every edge resolves', () => {
    const report = buildCanonicalReferenceIntegrityReport({
      environment: 'development',
      databaseName: 'Development',
      generatedAt: GENERATED_AT,
      inputs: [
        { name: 'signals.researchEntityId -> research_entities', required: true, missingRequired: 0, orphanedPresentRefs: 0 },
      ],
    });
    expect(report.summary.clean).toBe(true);
    expect(report.summary.hardFailureTotal).toBe(0);
    expect(report.summary.edgesWithFailures).toEqual([]);
  });

  it('surfaces missing-required and orphaned references as hard failures', () => {
    const report = buildCanonicalReferenceIntegrityReport({
      environment: 'development',
      databaseName: 'Development',
      generatedAt: GENERATED_AT,
      inputs: [
        { name: 'signals.researchEntityId -> research_entities', required: true, missingRequired: 2, orphanedPresentRefs: 1 },
        { name: 'role_assignments.evidenceClaimIds -> evidence_claims', required: false, missingRequired: 0, orphanedPresentRefs: 4 },
      ],
    });
    expect(report.summary.clean).toBe(false);
    expect(report.summary.missingRequiredTotal).toBe(2);
    expect(report.summary.orphanedPresentRefTotal).toBe(5);
    expect(report.summary.hardFailureTotal).toBe(7);
    expect(report.summary.edgesWithFailures).toEqual([
      'signals.researchEntityId -> research_entities',
      'role_assignments.evidenceClaimIds -> evidence_claims',
    ]);
  });

  it('ignores a missing value on an optional reference', () => {
    const report = buildCanonicalReferenceIntegrityReport({
      environment: 'development',
      databaseName: 'Development',
      generatedAt: GENERATED_AT,
      inputs: [
        { name: 'researchers.accountId -> accounts', required: false, missingRequired: 99, orphanedPresentRefs: 0 },
      ],
    });
    expect(report.summary.clean).toBe(true);
    expect(report.summary.missingRequiredTotal).toBe(0);
  });
});

describe('parseCanonicalReferenceIntegrityArgs', () => {
  it('requires an environment and supports include-samples', () => {
    expect(() => parseCanonicalReferenceIntegrityArgs([])).toThrow('--environment is required');
    const args = parseCanonicalReferenceIntegrityArgs([
      '--environment',
      'development',
      '--include-samples',
    ]);
    expect(args.environment).toBe('development');
    expect(args.includeSamples).toBe(true);
  });
});
