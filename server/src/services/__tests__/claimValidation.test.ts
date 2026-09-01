import { describe, expect, it } from 'vitest';
import {
  buildClaimGateReport,
  validateAccessArtifactBundle,
  type AccessArtifactCandidate,
} from '../claimValidation/accessClaims';

const base = {
  id: 'artifact-1',
  researchEntityId: 'entity-1',
  sourceEvidenceIds: ['obs-1'],
  sourceUrls: ['https://lab.yale.edu/join'],
};

describe('access claim validation', () => {
  it('accepts a source-backed access signal', () => {
    const artifacts: AccessArtifactCandidate[] = [
      {
        ...base,
        artifactType: 'AccessSignal',
        signalType: 'APPLICATION_FORM_EXISTS',
        derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
      },
    ];

    const result = validateAccessArtifactBundle(artifacts);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it('rejects an access signal with no source evidence', () => {
    const artifacts: AccessArtifactCandidate[] = [
      {
        id: 'artifact-2',
        researchEntityId: 'entity-1',
        sourceEvidenceIds: [],
        artifactType: 'AccessSignal',
        signalType: 'CURRENT_UNDERGRADS',
        derivationKey: 'signal:CURRENT_UNDERGRADS:JOIN_PAGE',
      },
    ];

    const result = validateAccessArtifactBundle(artifacts);

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((item) => item.reasons)).toEqual([['missing_source_evidence']]);
  });

  it('summarizes claim gate report counts and samples', () => {
    const report = buildClaimGateReport({
      artifacts: [
        {
          id: 'artifact-3',
          researchEntityId: 'entity-1',
          sourceEvidenceIds: [],
          artifactType: 'AccessSignal',
          signalType: 'CURRENT_UNDERGRADS',
          derivationKey: 'signal:CURRENT_UNDERGRADS:JOIN_PAGE',
        },
      ],
      includeSamples: true,
      sampleLimit: 5,
    });

    expect(report.summary).toMatchObject({
      accepted: 0,
      rejected: 1,
      review: 0,
    });
    expect(report.byReason).toEqual({ missing_source_evidence: 1 });
    expect(report.samples.rejected).toHaveLength(1);
  });
});
