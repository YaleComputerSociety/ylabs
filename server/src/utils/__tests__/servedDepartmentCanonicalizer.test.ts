import { describe, expect, it, vi } from 'vitest';

vi.mock('../../scrapers/orgUnitCanonicalization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../scrapers/orgUnitCanonicalization')>()),
  getOrgUnitCanonicalizer: vi.fn(async () => {
    throw new Error('synthetic catalog outage');
  }),
}));

import {
  catalogDepartmentDisplayName,
  servedDepartmentCanonicalizer,
} from '../catalogDepartmentDisplayName';

describe('the served member department when the catalog cannot be read (#6380)', () => {
  it('serves the stored spelling instead of failing the detail page', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const canonicalizer = await servedDepartmentCanonicalizer();

    expect(catalogDepartmentDisplayName(canonicalizer, 'English')).toBe('English');
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});
