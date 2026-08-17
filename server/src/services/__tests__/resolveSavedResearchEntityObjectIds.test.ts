import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  researchEntityFind: vi.fn(),
}));

vi.mock('../../models/index', () => ({
  ResearchEntity: {
    find: (...args: unknown[]) => {
      const docs = mocks.researchEntityFind(...args) ?? [];
      return {
        select: () => ({
          lean: () => docs,
        }),
      };
    },
  },
  User: {},
}));

import { resolveSavedResearchEntityObjectIds } from '../userService';

const HEX_A = '64a000000000000000000030';
const HEX_B = '64a000000000000000000031';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveSavedResearchEntityObjectIds', () => {
  it('passes ObjectId-hex values through without a slug lookup', async () => {
    const result = await resolveSavedResearchEntityObjectIds([HEX_A]);

    expect(mocks.researchEntityFind).not.toHaveBeenCalled();
    expect(result.map((id) => id.toHexString())).toEqual([HEX_A]);
  });

  it('resolves slug values to visible research entity ids', async () => {
    mocks.researchEntityFind.mockReturnValue([{ _id: new mongoose.Types.ObjectId(HEX_B) }]);

    const result = await resolveSavedResearchEntityObjectIds(['climate-archive']);

    expect(mocks.researchEntityFind).toHaveBeenCalledWith(
      expect.objectContaining({ slug: { $in: ['climate-archive'] } }),
    );
    expect(result.map((id) => id.toHexString())).toEqual([HEX_B]);
  });

  it('dedupes ObjectId and slug inputs that resolve to the same entity', async () => {
    mocks.researchEntityFind.mockReturnValue([{ _id: new mongoose.Types.ObjectId(HEX_A) }]);

    const result = await resolveSavedResearchEntityObjectIds([HEX_A, 'climate-archive']);

    expect(result.map((id) => id.toHexString())).toEqual([HEX_A]);
  });

  it('rejects malformed identifiers', async () => {
    await expect(resolveSavedResearchEntityObjectIds(['not a valid id!'])).rejects.toMatchObject({
      status: 400,
    });
  });
});
