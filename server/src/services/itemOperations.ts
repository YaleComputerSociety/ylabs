/**
 * Shared view and favorite operations for listings and fellowships.
 * Uses atomic $inc to avoid lost-update races under concurrent writes.
 */
import mongoose, { Model } from 'mongoose';
import { NotFoundError, ObjectIdError } from '../utils/errors';

const assertValidId = (id: any) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
};

export const addView = async (model: Model<any>, id: any) => {
  assertValidId(id);
  const updated = await model.findByIdAndUpdate(
    id,
    { $inc: { views: 1 } },
    { new: true, timestamps: false },
  );
  if (!updated) {
    throw new NotFoundError(`Item not found with ObjectId: ${id}`);
  }
  return updated.toObject();
};

export const addFavorite = async (model: Model<any>, id: any) => {
  assertValidId(id);
  const updated = await model.findByIdAndUpdate(
    id,
    { $inc: { favorites: 1 } },
    { new: true, timestamps: false },
  );
  if (!updated) {
    throw new NotFoundError(`Item not found with ObjectId: ${id}`);
  }
  return updated.toObject();
};

export const removeFavorite = async (model: Model<any>, id: any) => {
  assertValidId(id);
  // Atomic decrement guarded so favorites never drops below 0.
  const updated = await model.findOneAndUpdate(
    { _id: id, favorites: { $gt: 0 } },
    { $inc: { favorites: -1 } },
    { new: true, timestamps: false },
  );
  if (updated) return updated.toObject();
  // Filter didn't match: either missing, or already at 0. Distinguish.
  const existing = await model.findById(id);
  if (!existing) {
    throw new NotFoundError(`Item not found with ObjectId: ${id}`);
  }
  return existing.toObject();
};
