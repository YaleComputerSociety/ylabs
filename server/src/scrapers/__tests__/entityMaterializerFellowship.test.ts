import { afterEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fellowship materialization', () => {
  it('resolves fellowship observations through the Fellowship model', async () => {
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'Fixture Research Fellowship',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          field: 'applicationMaterials',
          value: ['Transcript'],
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
    } as any);
    const findOne = vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'yale-college-fellowships-office:fixture-research-fellowship' },
      { dryRun: true },
    );

    expect(findOne).toHaveBeenCalledWith({
      sourceKey: 'yale-college-fellowships-office:fixture-research-fellowship',
    });
    expect(result.skipped).toBeUndefined();
    expect(result.resolved.applicationMaterials?.value).toEqual(['Transcript']);
  });
});
