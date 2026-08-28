import fs from 'fs';
import { describe, expect, it } from 'vitest';
import * as models from '../../models/index';
import * as authMiddleware from '../../middleware/auth';

describe('faculty opportunity authoring surface removal (#301)', () => {
  it('stops exporting the retired Listing models from the barrel', () => {
    expect('Listing' in models).toBe(false);
    expect('ListingClaimRequest' in models).toBe(false);
  });

  it('does not export the listing creation authorization guard', () => {
    expect((authMiddleware as Record<string, unknown>).canCreateListing).toBeUndefined();
  });

  it('no longer ships a listing controller module', () => {
    expect(fs.existsSync(new URL('../listingController.ts', import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL('../../routes/listings.ts', import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL('../../services/listingService.ts', import.meta.url))).toBe(false);
  });
});
