import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import { trustedResearchScopeNarrativeFieldsByEntityId } from '../researchScopeNarrativeEvidence';

describe('trustedResearchScopeNarrativeFieldsByEntityId', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts only an exact current observation with ObjectId provenance links', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const observationId = new mongoose.Types.ObjectId();
    const sourceId = new mongoose.Types.ObjectId();
    const lean = vi.fn().mockResolvedValue([
      {
        _id: observationId,
        entityType: 'researchEntity',
        entityId,
        field: 'fullDescription',
        value: 'Conducts clinical research projects.',
        sourceId,
      },
    ]);
    const select = vi.fn().mockReturnValue({ lean });
    const find = vi.spyOn(Observation, 'find').mockReturnValue({ select } as any);

    const result = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: 'Conducts clinical research projects.',
        fieldProvenance: { fullDescription: { observationId, sourceId } },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        fullDescription: 'Conducts other research projects.',
        fieldProvenance: {
          fullDescription: { observationId: observationId.toString(), sourceId },
        },
      },
    ]);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        superseded: { $ne: true },
        'rollback.rolledBackAt': { $exists: false },
        sourceId: { $type: 'objectId' },
      }),
    );
    expect(result.get(entityId.toString())).toEqual(new Set(['fullDescription']));
    expect(result.size).toBe(1);
  });

  it('rejects observations whose entity, field, value, or source does not match', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const observationId = new mongoose.Types.ObjectId();
    const sourceId = new mongoose.Types.ObjectId();
    const lean = vi.fn().mockResolvedValue([
      {
        _id: observationId,
        entityType: 'researchEntity',
        entityId,
        field: 'fullDescription',
        value: 'An older narrative value.',
        sourceId,
      },
    ]);
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    } as any);

    const result = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: 'The current narrative value.',
        fieldProvenance: { fullDescription: { observationId, sourceId } },
      },
    ]);

    expect(result.size).toBe(0);
  });
});
