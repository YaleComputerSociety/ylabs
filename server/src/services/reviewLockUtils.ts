import type mongoose from 'mongoose';

export interface ReviewLockedRecord {
  review?: {
    status?: string;
    lockedFields?: string[];
  };
}

export async function findReviewLockedRecord(
  model: mongoose.Model<any>,
  filter: Record<string, unknown>,
): Promise<ReviewLockedRecord | null> {
  if (typeof (model as any).findOne !== 'function') return null;
  return (await model.findOne(filter).select('review.status review.lockedFields').lean()) as
    | ReviewLockedRecord
    | null;
}

export function omitReviewLockedFields<T extends Record<string, unknown>>(
  fields: T,
  record?: ReviewLockedRecord | null,
): Partial<T> {
  const locked = new Set(record?.review?.lockedFields || []);
  if (record?.review?.status === 'archived_by_review') {
    locked.add('archived');
  }

  if (locked.size === 0) return fields;

  return Object.fromEntries(
    Object.entries(fields).filter(([field]) => !locked.has(field)),
  ) as Partial<T>;
}
