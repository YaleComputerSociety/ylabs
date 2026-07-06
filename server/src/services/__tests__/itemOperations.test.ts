import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { addFavorite, addView, removeFavorite } from '../itemOperations';

const modelFor = () => ({
  findOneAndUpdate: vi.fn(async () => ({
    toObject: () => ({ _id: '67d8928150621bcef434a1d5', views: 1, favorites: 1 }),
  })),
  findOne: vi.fn(),
});

describe('itemOperations', () => {
  it('normalizes primitive and real ObjectId ids before item mutations', async () => {
    const model = modelFor();
    const id = new Types.ObjectId('67d8928150621bcef434a1d5');

    await addView(model as any, id);
    await addFavorite(model as any, '67d8928150621bcef434a1d5');

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '67d8928150621bcef434a1d5' },
      { $inc: { views: 1 } },
      { new: true, timestamps: false },
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '67d8928150621bcef434a1d5' },
      { $inc: { favorites: 1 } },
      { new: true, timestamps: false },
    );
  });

  it('rejects object-shaped ids without invoking conversion hooks', async () => {
    const model = modelFor();
    const unsafeId = {
      toString: () => {
        throw new Error('item operation stringified arbitrary id');
      },
      toHexString: () => {
        throw new Error('item operation called arbitrary id toHexString');
      },
    };

    await expect(addView(model as any, unsafeId)).rejects.toThrow('Did not receive expected id type ObjectId');
    await expect(addFavorite(model as any, unsafeId)).rejects.toThrow('Did not receive expected id type ObjectId');
    await expect(removeFavorite(model as any, unsafeId)).rejects.toThrow('Did not receive expected id type ObjectId');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(model.findOne).not.toHaveBeenCalled();
  });
});
