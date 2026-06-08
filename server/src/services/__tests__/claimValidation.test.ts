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
  it('rejects official application artifacts when no accepted official application pathway exists', () => {
    const artifacts: AccessArtifactCandidate[] = [
      {
        ...base,
        artifactType: 'AccessSignal',
        signalType: 'APPLICATION_FORM_EXISTS',
        derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
      },
      {
        ...base,
        artifactType: 'ContactRoute',
        routeType: 'OFFICIAL_APPLICATION',
        derivationKey: 'route:official_application:https://lab.yale.edu/join',
        url: 'https://lab.yale.edu/join',
      },
    ];

    const result = validateAccessArtifactBundle(artifacts);

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((item) => item.reasons)).toEqual([
      ['missing_official_application_pathway'],
      ['missing_official_application_pathway'],
    ]);
  });

  it('accepts a source-backed official application bundle with pathway, signal, and route', () => {
    const artifacts: AccessArtifactCandidate[] = [
      {
        ...base,
        artifactType: 'EntryPathway',
        pathwayType: 'RECURRING_PROGRAM',
        derivationKey: 'pathway:OFFICIAL_APPLICATION:JOIN_PAGE',
      },
      {
        ...base,
        artifactType: 'AccessSignal',
        signalType: 'APPLICATION_FORM_EXISTS',
        derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
      },
      {
        ...base,
        artifactType: 'ContactRoute',
        routeType: 'OFFICIAL_APPLICATION',
        derivationKey: 'route:official_application:https://lab.yale.edu/join',
        url: 'https://lab.yale.edu/join',
      },
    ];

    const result = validateAccessArtifactBundle(artifacts);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(3);
  });

  it('accepts already-linked official application artifacts even when derivation keys differ', () => {
    const artifacts: AccessArtifactCandidate[] = [
      {
        ...base,
        artifactType: 'AccessSignal',
        signalType: 'APPLICATION_FORM_EXISTS',
        entryPathwayId: 'pathway-1',
        derivationKey: 'application-route-backfill:signal',
      },
      {
        ...base,
        artifactType: 'ContactRoute',
        routeType: 'OFFICIAL_APPLICATION',
        entryPathwayId: 'pathway-1',
        derivationKey: 'application-route-backfill:route',
        url: 'https://lab.yale.edu/join',
      },
    ];

    const result = validateAccessArtifactBundle(artifacts);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);
  });

  it('marks formalization-only pathways for review instead of accepting them as access routes', () => {
    const result = validateAccessArtifactBundle([
      {
        ...base,
        artifactType: 'EntryPathway',
        pathwayType: 'FELLOWSHIP_FUNDED_PROJECT',
        derivationKey: 'pathway:FELLOWSHIP_FUNDED_PROJECT:test',
      },
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.review).toMatchObject([
      {
        status: 'review',
        reasons: ['formalization_only'],
      },
    ]);
  });

  it('summarizes claim gate report counts and samples', () => {
    const report = buildClaimGateReport({
      artifacts: [
        {
          ...base,
          artifactType: 'ContactRoute',
          routeType: 'OFFICIAL_APPLICATION',
          derivationKey: 'route:official_application:https://lab.yale.edu/join',
          url: 'https://lab.yale.edu/join',
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
    expect(report.byReason).toEqual({ missing_official_application_pathway: 1 });
    expect(report.samples.rejected).toHaveLength(1);
  });
});
