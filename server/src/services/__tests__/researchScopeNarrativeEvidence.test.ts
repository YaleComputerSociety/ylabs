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
    const sourceUrl = 'https://example.yale.edu/research';
    const lean = vi.fn().mockResolvedValue([
      {
        _id: observationId,
        entityType: 'researchEntity',
        entityId,
        field: 'fullDescription',
        value: 'Conducts clinical research projects.',
        sourceId,
        sourceUrl,
      },
    ]);
    const select = vi.fn().mockReturnValue({ lean });
    const find = vi.spyOn(Observation, 'find').mockReturnValue({ select } as any);

    const result = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: 'Conducts clinical research projects.',
        fieldProvenance: { fullDescription: { observationId, sourceId, sourceUrl } },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        fullDescription: 'Conducts other research projects.',
        fieldProvenance: {
          fullDescription: { observationId: observationId.toString(), sourceId, sourceUrl },
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
    const sourceUrl = 'https://example.yale.edu/research';
    const lean = vi.fn().mockResolvedValue([
      {
        _id: observationId,
        entityType: 'researchEntity',
        entityId,
        field: 'fullDescription',
        value: 'An older narrative value.',
        sourceId,
        sourceUrl,
      },
    ]);
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    } as any);

    const result = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: 'The current narrative value.',
        fieldProvenance: { fullDescription: { observationId, sourceId, sourceUrl } },
      },
    ]);

    expect(result.size).toBe(0);
  });

  it('accepts the supported legacy researchGroup observation type', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const observationId = new mongoose.Types.ObjectId();
    const sourceId = new mongoose.Types.ObjectId();
    const sourceUrl = 'https://example.yale.edu/center';
    const value = 'The center conducts interdisciplinary research.';
    const lean = vi.fn().mockResolvedValue([
      {
        _id: observationId,
        entityType: 'researchGroup',
        entityId,
        field: 'fullDescription',
        value,
        sourceId,
        sourceUrl,
      },
    ]);
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    } as any);

    const result = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: value,
        fieldProvenance: { fullDescription: { observationId, sourceId, sourceUrl } },
      },
    ]);

    expect(result.get(entityId.toString())).toEqual(new Set(['fullDescription']));
  });

  it('rejects mismatched or invalid observation source URLs', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const sourceId = new mongoose.Types.ObjectId();
    const value = 'The center conducts interdisciplinary research.';
    const matchingUrlObservationId = new mongoose.Types.ObjectId();
    const invalidUrlObservationId = new mongoose.Types.ObjectId();
    const lean = vi.fn().mockResolvedValue([
      {
        _id: matchingUrlObservationId,
        entityType: 'researchEntity',
        entityId,
        field: 'fullDescription',
        value,
        sourceId,
        sourceUrl: 'https://example.yale.edu/research',
      },
      {
        _id: invalidUrlObservationId,
        entityType: 'researchEntity',
        entityId,
        field: 'fullDescription',
        value,
        sourceId,
        sourceUrl: 'not-a-url',
      },
    ]);
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: vi.fn().mockReturnValue({ lean }),
    } as any);

    const mismatched = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: value,
        fieldProvenance: {
          fullDescription: {
            observationId: matchingUrlObservationId,
            sourceId,
            sourceUrl: 'https://unrelated.example.edu/research',
          },
        },
      },
    ]);
    const invalid = await trustedResearchScopeNarrativeFieldsByEntityId([
      {
        _id: entityId,
        fullDescription: value,
        fieldProvenance: {
          fullDescription: {
            observationId: invalidUrlObservationId,
            sourceId,
            sourceUrl: 'not-a-url',
          },
        },
      },
    ]);

    expect(mismatched.size).toBe(0);
    expect(invalid.size).toBe(0);
  });
});
