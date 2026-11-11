import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  DIRECTORY_REMOVAL_REQUEST_COLLECTION,
  DirectoryRemovalRequest,
} from '../directoryRemovalRequest';
import {
  NEVER_COPY_COLLECTIONS,
  PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
  assertNoNeverCopyCollections,
  assertNoPreservedCollectionsCleared,
} from '../../scripts/mirrorCollectionPolicy';

describe('DirectoryRemovalRequest', () => {
  it('is never copied by a promotion or mirror and is preserved by a refresh', () => {
    expect(DIRECTORY_REMOVAL_REQUEST_COLLECTION).toBe('directory_removal_requests');
    expect(NEVER_COPY_COLLECTIONS).toContain(DIRECTORY_REMOVAL_REQUEST_COLLECTION);
    expect(PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS).toContain(DIRECTORY_REMOVAL_REQUEST_COLLECTION);
    expect(() => assertNoNeverCopyCollections([DIRECTORY_REMOVAL_REQUEST_COLLECTION])).toThrow(
      /Refusing to mirror/,
    );
    expect(() =>
      assertNoPreservedCollectionsCleared([DIRECTORY_REMOVAL_REQUEST_COLLECTION]),
    ).toThrow(/Refusing to clear/);
  });

  it('stores only the netid, the matched researcher, the status and the decision', () => {
    expect(Object.keys(DirectoryRemovalRequest.schema.paths).sort()).toEqual(
      [
        '_id',
        'createdAt',
        'decidedAt',
        'decidedBy',
        'requesterNetid',
        'researcherId',
        'status',
      ].sort(),
    );
    expect(
      () =>
        new DirectoryRemovalRequest({
          requesterNetid: 'zz9xxx',
          researcherId: new mongoose.Types.ObjectId(),
          reason: 'free text',
        }),
    ).toThrow();
  });
});
