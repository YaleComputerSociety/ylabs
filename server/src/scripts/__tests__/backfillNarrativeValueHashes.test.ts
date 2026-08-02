import { afterEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { researchScopeEvidenceValueHash } from '../../services/researchEntityResearchScope';
import {
  parseNarrativeValueHashBackfillArgs,
  planNarrativeValueHashBackfill,
} from '../backfillNarrativeValueHashes';

describe('backfillNarrativeValueHashes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requires a bounded limit and explicit apply confirmation', () => {
    expect(() => parseNarrativeValueHashBackfillArgs([])).toThrow(
      '--limit must be a positive integer.',
    );
    expect(() => parseNarrativeValueHashBackfillArgs(['--apply', '--limit=10'])).toThrow(
      '--confirm-narrative-value-hashes is required with --apply.',
    );
  });

  it('plans hashes only from an exact, current observation with its own HTTP source URL', async () => {
    const description = 'The center conducts empirical research projects on learning.';
    const findLean = vi.fn().mockResolvedValue([
      {
        _id: 'entity-1',
        description,
        summary: 'Already certified',
        fieldProvenance: {
          summary: { valueHash: researchScopeEvidenceValueHash('Already certified') },
        },
      },
    ]);
    const findLimit = vi.fn(() => ({ lean: findLean }));
    const findSort = vi.fn(() => ({ limit: findLimit }));
    const findSelect = vi.fn(() => ({ sort: findSort }));
    vi.spyOn(ResearchEntity, 'find').mockReturnValue({ select: findSelect } as never);

    const observation = {
      _id: 'observation-1',
      sourceId: 'source-1',
      sourceName: 'official-center-page',
      sourceUrl: 'https://example.yale.edu/research-center',
      observedAt: new Date('2026-08-01T00:00:00.000Z'),
      confidence: 0.9,
    };
    const observationLean = vi.fn().mockResolvedValue(observation);
    const observationSort = vi.fn(() => ({ lean: observationLean }));
    const findOne = vi
      .spyOn(Observation, 'findOne')
      .mockReturnValue({ sort: observationSort } as never);

    const plans = await planNarrativeValueHashBackfill(25);

    expect(ResearchEntity.find).toHaveBeenCalledWith({ archived: { $ne: true } });
    expect(findSort).toHaveBeenCalledWith({ _id: 1 });
    expect(findLimit).toHaveBeenCalledWith(25);
    expect(findOne).toHaveBeenCalledOnce();
    expect(findOne).toHaveBeenCalledWith({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      entityId: 'entity-1',
      field: 'description',
      value: description,
      sourceId: { $type: 'objectId' },
      sourceName: { $type: 'string', $ne: '' },
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
      sourceUrl: { $regex: '^https?://', $options: 'i' },
    });
    expect(plans).toEqual([
      {
        entityId: 'entity-1',
        field: 'description',
        provenance: {
          observationId: 'observation-1',
          sourceId: 'source-1',
          sourceName: 'official-center-page',
          sourceUrl: 'https://example.yale.edu/research-center',
          valueHash: researchScopeEvidenceValueHash(description),
          observedAt: new Date('2026-08-01T00:00:00.000Z'),
          confidence: 0.9,
        },
      },
    ]);
  });
});
