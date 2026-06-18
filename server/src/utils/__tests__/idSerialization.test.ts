import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import { serializedDocumentId } from '../idSerialization';

describe('serializedDocumentId', () => {
  it('serializes primitive ids and real ObjectIds only', () => {
    expect(serializedDocumentId('  listing-1  ')).toBe('listing-1');
    expect(serializedDocumentId(123)).toBe('123');
    expect(serializedDocumentId(new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'))).toBe(
      '507f1f77bcf86cd799439011',
    );
  });

  it('does not call arbitrary object stringification hooks', () => {
    const value = {
      toString: () => {
        throw new Error('serialized arbitrary object id');
      },
      toHexString: () => {
        throw new Error('serialized arbitrary hex id');
      },
    };

    expect(serializedDocumentId(value)).toBeUndefined();
  });
});
