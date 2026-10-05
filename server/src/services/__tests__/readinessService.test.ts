import { afterEach, describe, expect, it, vi } from 'vitest';

const meili = vi.hoisted(() => ({ health: vi.fn() }));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchClient: async () => meili,
}));

import { defaultReadinessProbes } from '../readinessService';

afterEach(() => {
  meili.health.mockReset();
});

describe('default readiness probes', () => {
  it('refuses MongoDB readiness while the shared connection is not established', async () => {
    await expect(defaultReadinessProbes.mongo()).rejects.toThrow();
  });

  it('accepts search readiness only when Meilisearch reports itself available', async () => {
    meili.health.mockResolvedValueOnce({ status: 'available' });
    await expect(defaultReadinessProbes.search()).resolves.toBeUndefined();

    meili.health.mockResolvedValueOnce({ status: 'unavailable' });
    await expect(defaultReadinessProbes.search()).rejects.toThrow();
  });
});
