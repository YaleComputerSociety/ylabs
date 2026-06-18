import { describe, expect, it } from 'vitest';
import { upsertEntryPathway } from '../entryPathwayService';

describe('entryPathwayService', () => {
  it('does not upsert when required research entity ids are object-shaped', async () => {
    const model = {
      findOneAndUpdate: () => {
        throw new Error('should not query');
      },
    };

    const result = await upsertEntryPathway(
      {
        researchEntityId: { toString: () => '64f111111111111111111111' } as any,
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        evidenceStrength: 'WEAK',
        studentFacingLabel: 'Explore source-backed work',
        sourceEvidenceIds: [],
      },
      { model: model as any },
    );

    expect(result).toEqual({});
  });

  it('skips object-shaped source evidence ids before Mongo update construction', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'pathway-1' }),
        };
      },
    };

    await upsertEntryPathway(
      {
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        evidenceStrength: 'WEAK',
        studentFacingLabel: 'Explore source-backed work',
        sourceEvidenceIds: [
          { toString: () => '64f111111111111111111111' },
          '64f222222222222222222222',
        ] as any,
      },
      { model: model as any },
    );

    expect(capturedUpdate.$addToSet.sourceEvidenceIds.$each.map(String)).toEqual([
      '64f222222222222222222222',
    ]);
  });

  it('does not stringify object-shaped returned pathway ids', async () => {
    const unsafeId = {
      toString: () => {
        throw new Error('stringified arbitrary pathway id');
      },
      toHexString: () => {
        throw new Error('called arbitrary pathway id toHexString');
      },
    };
    const model = {
      findOneAndUpdate: () => ({
        lean: async () => ({ _id: unsafeId }),
      }),
    };

    const result = await upsertEntryPathway(
      {
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        evidenceStrength: 'WEAK',
        studentFacingLabel: 'Explore source-backed work',
        sourceEvidenceIds: [],
      },
      { model: model as any },
    );

    expect(result.pathwayId).toBeUndefined();
  });
});
