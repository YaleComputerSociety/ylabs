import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminGrant } from '../../models/adminGrant';
import {
  MAX_ADMIN_GRANT_NOTE_LENGTH,
  allowsLegacyAdminUserType,
  grantAdminAccess,
  hasActiveAdminGrant,
  revokeAdminAccess,
} from '../adminGrantService';

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

describe('admin grant note persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caps grant notes before persistence', async () => {
    const findOneAndUpdate = vi
      .spyOn(AdminGrant, 'findOneAndUpdate')
      .mockReturnValue({ lean: vi.fn().mockResolvedValue({}) } as any);

    await grantAdminAccess({
      netid: 'abc123',
      actorNetid: 'admin1',
      note: ` ${'x'.repeat(MAX_ADMIN_GRANT_NOTE_LENGTH + 50)} `,
    });

    const update = findOneAndUpdate.mock.calls[0][1] as any;
    expect(update.$set.note).toHaveLength(MAX_ADMIN_GRANT_NOTE_LENGTH);
    expect(update.$set.note).toBe('x'.repeat(MAX_ADMIN_GRANT_NOTE_LENGTH));
  });

  it('caps revoke notes before persistence', async () => {
    const findOneAndUpdate = vi
      .spyOn(AdminGrant, 'findOneAndUpdate')
      .mockReturnValue({ lean: vi.fn().mockResolvedValue({}) } as any);

    await revokeAdminAccess({
      netid: 'abc123',
      actorNetid: 'admin1',
      note: ` ${'y'.repeat(MAX_ADMIN_GRANT_NOTE_LENGTH + 50)} `,
    });

    const update = findOneAndUpdate.mock.calls[0][1] as any;
    expect(update.$set.revokeNote).toHaveLength(MAX_ADMIN_GRANT_NOTE_LENGTH);
    expect(update.$set.revokeNote).toBe('y'.repeat(MAX_ADMIN_GRANT_NOTE_LENGTH));
  });
});
