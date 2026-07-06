import { describe, expect, it } from 'vitest';
import { upsertAccessSignal } from '../accessSignalService';

describe('accessSignalService', () => {
  it('does not upsert when required research entity ids are object-shaped', async () => {
    const model = {
      findOneAndUpdate: () => {
        throw new Error('should not query');
      },
    };

    const result = await upsertAccessSignal(
      {
        researchEntityId: { toString: () => '64f111111111111111111111' } as any,
        signalType: 'POSTED_OPENING',
        confidence: 'HIGH',
        observedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
      { model: model as any },
    );

    expect(result).toEqual({});
  });

  it('skips object-shaped optional ids before Mongo update construction', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'signal-1' }),
        };
      },
    };

    await upsertAccessSignal(
      {
        researchEntityId: 'entity-1',
        entryPathwayId: { toString: () => '64f111111111111111111111' } as any,
        sourceEvidenceId: { toString: () => '64f222222222222222222222' } as any,
        signalType: 'POSTED_OPENING',
        confidence: 'HIGH',
        observedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
      { model: model as any },
    );

    expect(capturedUpdate.$set).not.toHaveProperty('entryPathwayId');
    expect(capturedUpdate.$set).not.toHaveProperty('sourceEvidenceId');
    expect(capturedUpdate.$set).not.toHaveProperty('observationId');
  });

  it('does not stringify object-shaped returned signal ids', async () => {
    const unsafeId = {
      toString: () => {
        throw new Error('stringified arbitrary signal id');
      },
      toHexString: () => {
        throw new Error('called arbitrary signal id toHexString');
      },
    };
    const model = {
      findOneAndUpdate: () => ({
        lean: async () => ({ _id: unsafeId }),
      }),
    };

    const result = await upsertAccessSignal(
      {
        researchEntityId: 'entity-1',
        signalType: 'POSTED_OPENING',
        confidence: 'HIGH',
        observedAt: new Date('2026-06-11T00:00:00.000Z'),
      },
      { model: model as any },
    );

    expect(result.signalId).toBeUndefined();
  });
});
