/**
 * Shared view and favorite operations for listings and fellowships.
 */
import mongoose, { Model } from 'mongoose';
import { NotFoundError, ObjectIdError } from '../utils/errors';

const findItem = async (model: Model<any>, id: any) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
  const item = await model.findById(id);
  if (!item) {
    throw new NotFoundError(`Item not found with ObjectId: ${id}`);
  }
  return item;
};

export const addView = async (model: Model<any>, id: any) => {
  const item = await findItem(model, id);
  const views = (item.views as number) || 0;
  const updated = await model.findByIdAndUpdate(
    id,
    { views: views + 1 },
    { new: true, timestamps: false }
  );
  return updated!.toObject();
};

export const addFavorite = async (model: Model<any>, id: any) => {
  const item = await findItem(model, id);
  const favorites = (item.favorites as number) || 0;
  const updated = await model.findByIdAndUpdate(
    id,
    { favorites: favorites + 1 },
    { new: true, timestamps: false }
  );
  return updated!.toObject();
};

export const removeFavorite = async (model: Model<any>, id: any) => {
  const item = await findItem(model, id);
  const favorites = (item.favorites as number) || 0;
  const newFavorites = favorites <= 0 ? 0 : favorites - 1;
  const updated = await model.findByIdAndUpdate(
    id,
    { favorites: newFavorites },
    { new: true, timestamps: false }
  );
  return updated!.toObject();
};
