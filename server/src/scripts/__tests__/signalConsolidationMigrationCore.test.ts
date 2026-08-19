import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  accessSignalToSignal,
  logisticsClaimToSignal,
  planSignalConsolidation,
} from '../signalConsolidationMigrationCore';

const oid = () => new mongoose.Types.ObjectId();

describe('signalConsolidationMigrationCore', () => {
  it('maps an access signal into the nested-source Signal shape', () => {
    const _id = oid();
    const entityId = oid();
    const evidenceId = oid();
    const signal = accessSignalToSignal({
      _id,
      researchEntityId: entityId,
      signalType: 'CURRENT_UNDERGRADS',
      confidence: 'HIGH',
      confidenceScore: 0.9,
      originalConfidence: 0.8,
      sourceName: 'Lab site',
      sourceUrl: 'https://example.edu/lab',
      excerpt: 'Undergraduates contribute to projects.',
      sourceEvidenceId: evidenceId,
      observedAt: new Date('2026-01-01'),
      derivationKey: 'access-materializer:CURRENT_UNDERGRADS:x',
      archived: false,
    });

    expect(signal).not.toBeNull();
    expect(signal?._id).toBe(_id);
    expect(signal?.type).toBe('CURRENT_UNDERGRADS');
    expect(signal?.confidence).toBe('HIGH');
    expect(signal?.confidenceScore).toBe(0.9);
    expect(signal?.source).toEqual({
      name: 'Lab site',
      url: 'https://example.edu/lab',
      excerpt: 'Undergraduates contribute to projects.',
      evidenceIds: [evidenceId],
      scrapeRunIds: [],
    });
  });

  it('maps a logistics claim into a type-based Signal with a stable derivationKey', () => {
    const _id = oid();
    const signal = logisticsClaimToSignal({
      _id,
      researchEntityId: oid(),
      claimType: 'COMPENSATION',
      status: 'KNOWN',
      value: { modes: ['PAID'] },
      sourceName: 'Program page',
      sourceUrl: 'https://example.edu/program',
      evidenceExcerpt: 'Paid positions available.',
      sourceEvidenceIds: [],
      sourceScrapeRunIds: [],
      observedAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-06-01'),
      materializedAt: new Date('2026-01-02'),
      archived: false,
    });

    expect(signal?.type).toBe('COMPENSATION');
    expect(signal?.status).toBe('KNOWN');
    expect(signal?.value).toEqual({ modes: ['PAID'] });
    expect(signal?.derivationKey).toBe('logistics:COMPENSATION');
    expect(signal?.source.excerpt).toBe('Paid positions available.');
    expect(signal?.lastMaterializedAt).toEqual(new Date('2026-01-02'));
  });

  it('skips documents with unknown types and counts them', () => {
    expect(accessSignalToSignal({ signalType: 'NOT_A_TYPE' })).toBeNull();
    expect(logisticsClaimToSignal({ claimType: 'NOT_A_TYPE' })).toBeNull();

    const plan = planSignalConsolidation(
      [
        { _id: oid(), researchEntityId: oid(), signalType: 'POSTED_OPENING' },
        { _id: oid(), researchEntityId: oid(), signalType: 'GARBAGE' },
      ],
      [{ _id: oid(), researchEntityId: oid(), claimType: 'MODALITY' }],
    );

    expect(plan.accessSignalsMapped).toBe(1);
    expect(plan.accessSignalsSkipped).toBe(1);
    expect(plan.logisticsClaimsMapped).toBe(1);
    expect(plan.signals).toHaveLength(2);
  });
});
