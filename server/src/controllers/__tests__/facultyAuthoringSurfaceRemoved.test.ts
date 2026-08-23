import { describe, expect, it } from 'vitest';
import * as listingController from '../listingController';
import * as authMiddleware from '../../middleware/auth';

describe('faculty opportunity authoring surface removal (#301)', () => {
  it('does not export faculty listing authoring handlers', () => {
    const authoringHandlers = [
      'createListingForCurrentUser',
      'getSkeletonListingForCurrentUser',
      'updateListingForCurrentUser',
      'archiveListingForCurrentUser',
      'unarchiveListingForCurrentUser',
      'deleteListingForCurrentUser',
    ];

    for (const handler of authoringHandlers) {
      expect((listingController as Record<string, unknown>)[handler]).toBeUndefined();
    }
  });

  it('keeps source-backed listing read and student interaction handlers', () => {
    expect(typeof listingController.getListingById).toBe('function');
    expect(typeof listingController.recordListingOutreach).toBe('function');
    expect(typeof listingController.addViewToListing).toBe('function');
  });

  it('does not export the listing creation authorization guard', () => {
    expect((authMiddleware as Record<string, unknown>).canCreateListing).toBeUndefined();
  });
});
