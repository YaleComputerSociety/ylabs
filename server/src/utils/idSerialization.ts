import mongoose from 'mongoose';

export const serializedDocumentId = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toHexString();
  }

  return undefined;
};
