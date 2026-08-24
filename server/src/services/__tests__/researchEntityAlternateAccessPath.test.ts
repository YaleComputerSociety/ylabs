import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  relationshipFind: vi.fn(),
  entityFind: vi.fn(),
}));

vi.mock('../../models/researchEntityRelationship', () => ({
  ResearchEntityRelationship: { find: mocks.relationshipFind },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { find: mocks.entityFind },
}));

import { countResearchEntityAlternateAccessPaths } from '../researchEntityAlternateAccessPath';

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439012';
const C = '507f1f77bcf86cd799439013';
const X = '507f1f77bcf86cd799439021';
const Y = '507f1f77bcf86cd799439022';
const Z = '507f1f77bcf86cd799439023';

const chain = (rows: any[]) => ({
  select: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(rows),
});

describe('countResearchEntityAlternateAccessPaths', () => {
  beforeEach(() => {
    mocks.relationshipFind.mockReset();
    mocks.entityFind.mockReset();
  });

  it('returns an empty map when no entity ids are provided', async () => {
    const counts = await countResearchEntityAlternateAccessPaths([]);
    expect(counts.size).toBe(0);
    expect(mocks.relationshipFind).not.toHaveBeenCalled();
  });

  it('counts live related and affiliated entities, dedupes neighbors, and excludes archived counterparts', async () => {
    mocks.relationshipFind.mockReturnValue(
      chain([
        { sourceResearchEntityId: A, targetResearchEntityId: X },
        { sourceResearchEntityId: X, targetResearchEntityId: A },
        { sourceResearchEntityId: Y, targetResearchEntityId: B },
        { sourceResearchEntityId: C, targetResearchEntityId: Z },
        { sourceResearchEntityId: A, targetResearchEntityId: B },
      ]),
    );
    mocks.entityFind.mockReturnValue(chain([{ _id: X }, { _id: Y }, { _id: A }, { _id: B }]));

    const counts = await countResearchEntityAlternateAccessPaths([A, B, C]);

    expect(counts.get(A)).toBe(2);
    expect(counts.get(B)).toBe(2);
    expect(counts.get(C) || 0).toBe(0);
  });

  it('does not credit a relationship whose only counterpart is archived', async () => {
    mocks.relationshipFind.mockReturnValue(
      chain([{ sourceResearchEntityId: C, targetResearchEntityId: Z }]),
    );
    mocks.entityFind.mockReturnValue(chain([]));

    const counts = await countResearchEntityAlternateAccessPaths([C]);

    expect(counts.get(C) || 0).toBe(0);
  });
});
