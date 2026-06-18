import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
}));

vi.mock('../../models/scrapeSnapshot', () => ({
  ScrapeSnapshot: {
    deleteMany: mocks.deleteMany,
  },
}));

import { invalidateCache } from '../snapshotCache';

describe('snapshotCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escapes request key prefixes before cache invalidation regex deletion', async () => {
    mocks.deleteMany.mockResolvedValue({ deletedCount: 2 });

    const deleted = await invalidateCache('source', 'page.*(1)');

    expect(deleted).toBe(2);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      sourceName: 'source',
      requestKey: { $regex: '^page\\.\\*\\(1\\)' },
    });
  });

  it('rejects oversized request key prefixes before cache invalidation work', async () => {
    await expect(invalidateCache('source', 'x'.repeat(513))).rejects.toThrow(
      'Cache request key prefix is too long',
    );

    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
