import type mongoose from 'mongoose';

export interface SuppressionLockedRecord {
  suppression?: {
    reason?: string;
    lockedFields?: string[];
  };
}

export async function findSuppressionLockedRecord(
  model: mongoose.Model<any>,
  filter: Record<string, unknown>,
): Promise<SuppressionLockedRecord | null> {
  if (typeof (model as any).findOne !== 'function') return null;
  return (await model
    .findOne(filter)
    .select('suppression.reason suppression.lockedFields')
    .lean()) as SuppressionLockedRecord | null;
}

export function isSuppressed(record?: SuppressionLockedRecord | null): boolean {
  return Boolean(record?.suppression?.reason);
}

export function omitSuppressionLockedFields<T extends Record<string, unknown>>(
  fields: T,
  record?: SuppressionLockedRecord | null,
): Partial<T> {
  const locked = new Set(record?.suppression?.lockedFields || []);
  if (isSuppressed(record)) {
    locked.add('archived');
  }

  if (locked.size === 0) return fields;

  return Object.fromEntries(
    Object.entries(fields).filter(([field]) => !locked.has(field)),
  ) as Partial<T>;
}
