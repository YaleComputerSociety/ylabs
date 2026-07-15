import { describe, expect, it, vi } from 'vitest';
import { applyValidatedPathwayDecisions } from '../pfr3PathwayEvidenceApplyCore';
import type { ValidatedDecision } from '../pfr3PathwayEvidenceReviewCore';

const decision = (
  kind: 'recency' | 'source_repair' | 'new_source' = 'recency',
): ValidatedDecision => ({
  handle: 'pathway-123456789abc',
  kind,
  sourceUrl: 'https://example.edu/join',
  evidence: 'Current application instructions.',
  rationale: 'Official page reviewed.',
  disposition: kind === 'recency' ? 'apply_recency' : 'manual_only',
  reason: 'test',
});

function dependencies() {
  return {
    findEvidence: vi.fn(async () => [
      {
        id: 'obs-1',
        entityType: 'researchEntity' as const,
        entityId: 'entity-1',
        field: 'joinPage',
        value: true,
        sourceId: 'source-1',
        sourceName: 'official',
        sourceUrl: 'https://example.edu/join',
        confidence: 0.9,
      },
    ]),
    alreadyApplied: vi.fn(async () => false),
    appendEvidence: vi.fn(async () => undefined),
    materialize: vi.fn(async () => undefined),
    writeAudit: vi.fn(async () => undefined),
  };
}

describe('PFR-3 pathway evidence application', () => {
  it('re-observes matching evidence and uses normal materialization', async () => {
    const deps = dependencies();
    const result = await applyValidatedPathwayDecisions({
      decisions: [decision()],
      candidates: new Map([
        [
          'pathway-123456789abc',
          { recordId: 'path-1', researchEntityId: 'entity-1', sourceEvidenceIds: ['obs-1'] },
        ],
      ]),
      target: 'beta',
      artifactHash: 'hash',
      restoreToken: 'restore',
      deps,
    });
    expect(result).toEqual({ applied: 1, idempotent: 0, manualOnly: 0, rejected: 0 });
    expect(deps.appendEvidence).toHaveBeenCalledOnce();
    expect(deps.materialize).toHaveBeenCalledWith('entity-1');
    expect(deps.writeAudit).toHaveBeenCalledOnce();
  });

  it('is idempotent before any write', async () => {
    const deps = dependencies();
    deps.alreadyApplied.mockResolvedValue(true);
    const result = await applyValidatedPathwayDecisions({
      decisions: [decision()],
      candidates: new Map([
        [
          'pathway-123456789abc',
          { recordId: 'path-1', researchEntityId: 'entity-1', sourceEvidenceIds: ['obs-1'] },
        ],
      ]),
      target: 'beta',
      artifactHash: 'hash',
      restoreToken: 'restore',
      deps,
    });
    expect(result.idempotent).toBe(1);
    expect(deps.appendEvidence).not.toHaveBeenCalled();
  });

  it('rejects mismatched provenance and keeps unsupported actions manual', async () => {
    const deps = dependencies();
    deps.findEvidence.mockResolvedValue([]);
    const result = await applyValidatedPathwayDecisions({
      decisions: [decision(), decision('source_repair'), decision('new_source')],
      candidates: new Map([
        [
          'pathway-123456789abc',
          { recordId: 'path-1', researchEntityId: 'entity-1', sourceEvidenceIds: ['obs-1'] },
        ],
      ]),
      target: 'beta',
      artifactHash: 'hash',
      restoreToken: 'restore',
      deps,
    });
    expect(result).toEqual({ applied: 0, idempotent: 0, manualOnly: 2, rejected: 1 });
    expect(deps.materialize).not.toHaveBeenCalled();
  });
});
