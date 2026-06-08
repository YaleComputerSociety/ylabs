import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminGrant } from '../../models/adminGrant';
import { allowsLegacyAdminUserType, hasActiveAdminGrant } from '../adminGrantService';

describe('hasActiveAdminGrant', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes valid netids before checking for an active grant', async () => {
    const exists = vi.spyOn(AdminGrant, 'exists').mockResolvedValue({ _id: 'grant-1' } as any);

    await expect(hasActiveAdminGrant(' ABC123 ')).resolves.toBe(true);

    expect(exists).toHaveBeenCalledWith({ netid: 'abc123', status: 'active' });
  });

  it('fails closed for invalid netids without querying Mongo', async () => {
    const exists = vi.spyOn(AdminGrant, 'exists').mockResolvedValue({ _id: 'grant-1' } as any);

    await expect(hasActiveAdminGrant('abc123.*')).resolves.toBe(false);

    expect(exists).not.toHaveBeenCalled();
  });
});

describe('allowsLegacyAdminUserType', () => {
  it('allows legacy admin userType only for localhost development', () => {
    expect(
      allowsLegacyAdminUserType({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
      } as NodeJS.ProcessEnv),
    ).toBe(true);

    expect(
      allowsLegacyAdminUserType({
        NODE_ENV: 'production',
        SERVER_BASE_URL: 'https://yalelabs.io',
      } as NodeJS.ProcessEnv),
    ).toBe(false);

    expect(
      allowsLegacyAdminUserType({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'https://yalelabs.io',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
