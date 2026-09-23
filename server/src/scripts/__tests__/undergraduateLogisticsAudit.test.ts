import { describe, expect, it } from 'vitest';
import {
  buildUndergraduateLogisticsCoverage,
  buildUndergraduateLogisticsProducerYield,
  evaluateUndergraduateLogisticsPrecision,
  selectUndergraduateLogisticsAuditSample,
  type LogisticsAuditClaim,
} from '../undergraduateLogisticsAuditCore';
import { UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS } from '../../scrapers/undergraduateLogisticsMaterializer';

const NOW = new Date('2026-07-14T00:00:00.000Z');
const entities = [
  { id: 'entity-1', slug: 'one' },
  { id: 'entity-2', slug: 'two' },
];
const claims: LogisticsAuditClaim[] = [
  {
    id: 'claim-1',
    researchEntityId: 'entity-1',
    claimType: 'COMPENSATION',
    status: 'KNOWN',
    value: { modes: ['PAID'] },
    sourceName: 'lab-microsite-undergrad-llm',
    sourceUrl: 'https://example.yale.edu/one',
    evidenceExcerpt: 'This is a paid position.',
    sourceEvidenceIds: ['observation-1'],
    observedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2027-07-01T00:00:00.000Z',
  },
];

describe('undergraduate logistics audit', () => {
  it('reports coverage independently for every claim', () => {
    const coverage = buildUndergraduateLogisticsCoverage(entities, claims, NOW);
    expect(coverage.find((row) => row.claimType === 'COMPENSATION')).toMatchObject({
      known: 1,
      unknown: 1,
      coverageRate: 0.5,
    });
    expect(coverage.find((row) => row.claimType === 'MODALITY')).toMatchObject({
      known: 0,
      unknown: 2,
      coverageRate: 0,
    });
  });

  it('does not count claims attached to excluded entities', () => {
    const coverage = buildUndergraduateLogisticsCoverage(
      [{ id: 'entity-1', slug: 'one' }],
      [{ ...claims[0], researchEntityId: 'archived-entity' }],
      NOW,
    );

    expect(coverage.find((row) => row.claimType === 'COMPENSATION')).toMatchObject({
      known: 0,
      unknown: 1,
      coverageRate: 0,
    });
  });

  it('requires complete sampled review before passing the precision gate', () => {
    const sample = selectUndergraduateLogisticsAuditSample(entities, claims, 25, NOW);
    expect(evaluateUndergraduateLogisticsPrecision(sample, [], 0.95).releaseReady).toBe(false);

    const passed = evaluateUndergraduateLogisticsPrecision(
      sample,
      [{ claimHandle: sample[0].claimHandle, correct: true }],
      0.95,
    );
    expect(passed).toMatchObject({ state: 'passed', precision: 1, releaseReady: true });
  });

  it('fails broad release when sampled precision is below the agreed threshold', () => {
    const sample = selectUndergraduateLogisticsAuditSample(entities, claims, 25, NOW);
    const result = evaluateUndergraduateLogisticsPrecision(
      sample,
      [{ claimHandle: sample[0].claimHandle, correct: false }],
      0.95,
    );
    expect(result).toMatchObject({ state: 'failed', precision: 0, releaseReady: false });
  });

  it('keeps review identity across refreshes and changes it for material evidence changes', () => {
    const original = selectUndergraduateLogisticsAuditSample(entities, claims, 25, NOW)[0];
    const changedExcerpt = selectUndergraduateLogisticsAuditSample(
      entities,
      [{ ...claims[0], evidenceExcerpt: 'Undergraduate students receive hourly pay.' }],
      25,
      NOW,
    )[0];
    const refreshedObservation = selectUndergraduateLogisticsAuditSample(
      entities,
      [{ ...claims[0], sourceEvidenceIds: ['observation-2'] }],
      25,
      NOW,
    )[0];
    const formattingOnly = selectUndergraduateLogisticsAuditSample(
      entities,
      [{ ...claims[0], evidenceExcerpt: '  THIS is a paid   position. ' }],
      25,
      NOW,
    )[0];
    const changedSource = selectUndergraduateLogisticsAuditSample(
      entities,
      [{ ...claims[0], sourceName: 'manual-admin-edit' }],
      25,
      NOW,
    )[0];

    expect(changedExcerpt.claimHandle).not.toBe(original.claimHandle);
    expect(refreshedObservation.claimHandle).toBe(original.claimHandle);
    expect(formattingOnly.claimHandle).toBe(original.claimHandle);
    expect(changedSource.claimHandle).not.toBe(original.claimHandle);
  });

  it('splits producer yield per claim type so a never-accepted claim reads apart from a sparse one', () => {
    const fields = UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS;
    const yieldRows = buildUndergraduateLogisticsProducerYield(
      [
        { field: fields.CURRENT_AVAILABILITY, accepted: true },
        { field: fields.CURRENT_AVAILABILITY, accepted: true },
        {
          field: fields.CURRENT_AVAILABILITY,
          accepted: false,
          rejectedReason: 'evidence_does_not_support_exact_claim',
        },
        {
          field: fields.COMPENSATION,
          accepted: false,
          rejectedReason: 'evidence_does_not_support_exact_claim',
        },
        {
          field: fields.COMPENSATION,
          accepted: false,
          rejectedReason: 'evidence_does_not_support_exact_claim',
        },
        { field: fields.COMPENSATION, accepted: false, rejectedReason: 'invalid_evidence_quote' },
      ],
      fields,
    );

    expect(yieldRows.find((row) => row.claimType === 'CURRENT_AVAILABILITY')).toEqual({
      claimType: 'CURRENT_AVAILABILITY',
      observations: 3,
      accepted: 2,
      rejected: 1,
      acceptRate: 2 / 3,
      rejectedReasons: { evidence_does_not_support_exact_claim: 1 },
    });
    expect(yieldRows.find((row) => row.claimType === 'COMPENSATION')).toEqual({
      claimType: 'COMPENSATION',
      observations: 3,
      accepted: 0,
      rejected: 3,
      acceptRate: 0,
      rejectedReasons: {
        evidence_does_not_support_exact_claim: 2,
        invalid_evidence_quote: 1,
      },
    });
  });

  it('reports a claim type the producer never attempted as zero observations, not zero accepted', () => {
    const yieldRows = buildUndergraduateLogisticsProducerYield(
      [{ field: UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS.MODALITY, accepted: true }],
      UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS,
    );

    expect(yieldRows.find((row) => row.claimType === 'TIME_COMMITMENT')).toEqual({
      claimType: 'TIME_COMMITMENT',
      observations: 0,
      accepted: 0,
      rejected: 0,
      acceptRate: 0,
      rejectedReasons: {},
    });
    expect(yieldRows.map((row) => row.claimType)).toEqual([
      'STUDENT_LEVEL',
      'COMPENSATION',
      'TIME_COMMITMENT',
      'MODALITY',
      'CURRENT_AVAILABILITY',
    ]);
  });

  it('ignores an observation whose field belongs to no logistics claim type', () => {
    const yieldRows = buildUndergraduateLogisticsProducerYield(
      [
        { field: 'fullDescription', accepted: true },
        { field: UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS.MODALITY, accepted: true },
      ],
      UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS,
    );

    expect(yieldRows.reduce((sum, row) => sum + row.observations, 0)).toBe(1);
  });
});
