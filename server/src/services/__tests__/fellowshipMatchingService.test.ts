import { describe, expect, it } from 'vitest';
import { matchFellowshipsForPathways } from '../fellowshipMatchingService';

describe('fellowshipMatchingService', () => {
  it('returns no matches now that pathway-based matching is removed (#363)', async () => {
    await expect(matchFellowshipsForPathways()).resolves.toEqual({});
  });
});
