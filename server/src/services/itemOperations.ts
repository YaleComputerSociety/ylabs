/**
 * Shared view and favorite operations for listings and fellowships.
 * Uses atomic $inc to avoid lost-update races under concurrent writes.
 */
import { Model } from 'mongoose';
import { NotFoundError, ObjectIdError } from '../utils/errors';
import { serializedDocumentId } from '../utils/idSerialization';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

const normalizeItemObjectId = (id: unknown): string => {
  const value = serializedDocumentId(id);
  if (value && OBJECT_ID_RE.test(value)) return value;
  throw new ObjectIdError('Did not receive expected id type ObjectId');
};

type ItemMutationFilter = Record<string, unknown>;

export const addView = async (model: Model<any>, id: any, filter: ItemMutationFilter = {}) => {
  const safeId = normalizeItemObjectId(id);
  const updated = await model.findOneAndUpdate(
    { _id: safeId, ...filter },
    { $inc: { views: 1 } },
    { new: true, timestamps: false },
  );
  if (!updated) {
    throw new NotFoundError('Item not found');
  }
  return updated.toObject();
};

export const addFavorite = async (model: Model<any>, id: any, filter: ItemMutationFilter = {}) => {
  const safeId = normalizeItemObjectId(id);
  const updated = await model.findOneAndUpdate(
    { _id: safeId, ...filter },
    { $inc: { favorites: 1 } },
    { new: true, timestamps: false },
  );
  if (!updated) {
    throw new NotFoundError('Item not found');
  }
  return updated.toObject();
};

export const removeFavorite = async (model: Model<any>, id: any, filter: ItemMutationFilter = {}) => {
  const safeId = normalizeItemObjectId(id);
  // Atomic decrement guarded so favorites never drops below 0.
  const updated = await model.findOneAndUpdate(
    { _id: safeId, ...filter, favorites: { $gt: 0 } },
    { $inc: { favorites: -1 } },
    { new: true, timestamps: false },
  );
  if (updated) return updated.toObject();
  // Filter didn't match: either missing, or already at 0. Distinguish.
  const existing = await model.findOne({ _id: safeId, ...filter });
  if (!existing) {
    throw new NotFoundError('Item not found');
  }
  return existing.toObject();
};
