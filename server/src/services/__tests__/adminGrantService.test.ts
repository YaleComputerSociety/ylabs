import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminGrant } from '../../models/adminGrant';
import { User } from '../../models/user';
import {
  MAX_ADMIN_GRANT_NOTE_LENGTH,
  clearAdminGrantCache,
  grantAdminAccess,
  hasActiveAdminGrant,
  hasAdminAuthorityForUser,
  listAdminGrants,
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

describe('hasAdminAuthorityForUser', () => {
  beforeEach(() => {
    clearAdminGrantCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAdminGrantCache();
  });

  it('grants authority from an active grant regardless of userType', async () => {
    const exists = vi.spyOn(AdminGrant, 'exists').mockResolvedValue({ _id: 'grant-1' } as any);

    await expect(hasAdminAuthorityForUser({ netId: 'grantee1' })).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith({ netid: 'grantee1', status: 'active' });
  });

  it('denies a principal with no active grant', async () => {
    vi.spyOn(AdminGrant, 'exists').mockResolvedValue(null as any);

    await expect(hasAdminAuthorityForUser({ netid: 'legacy9' })).resolves.toBe(false);
  });

  it('denies a missing principal', async () => {
    await expect(hasAdminAuthorityForUser(null)).resolves.toBe(false);
  });
});

describe('admin grant note persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing and oversized grant notes', async () => {
    const findOneAndUpdate = vi
      .spyOn(AdminGrant, 'findOneAndUpdate')
      .mockReturnValue({ lean: vi.fn().mockResolvedValue({}) } as any);

    await expect(
      grantAdminAccess({ netid: 'abc123', actorNetid: 'admin1', note: '   ' }),
    ).rejects.toThrow();
    await expect(
      grantAdminAccess({
        netid: 'abc123',
        actorNetid: 'admin1',
        note: 'x'.repeat(MAX_ADMIN_GRANT_NOTE_LENGTH + 1),
      }),
    ).rejects.toThrow();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects self grants before persistence', async () => {
    const findOneAndUpdate = vi.spyOn(AdminGrant, 'findOneAndUpdate');
    await expect(
      grantAdminAccess({ netid: 'admin1', actorNetid: 'ADMIN1', note: 'reviewed' }),
    ).rejects.toThrow();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects oversized revoke notes before persistence', async () => {
    const findOneAndUpdate = vi
      .spyOn(AdminGrant, 'findOneAndUpdate')
      .mockReturnValue({ lean: vi.fn().mockResolvedValue({}) } as any);

    await expect(
      revokeAdminAccess({
        netid: 'abc123',
        actorNetid: 'admin1',
        note: 'y'.repeat(MAX_ADMIN_GRANT_NOTE_LENGTH + 1),
      }),
    ).rejects.toThrow();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('listAdminGrants history timeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates grant/revoke history across all grants newest-first', async () => {
    const activeChain: any = {
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ netid: 'admin2', status: 'active' }]),
    };
    const allHistoryChain: any = {
      lean: vi.fn().mockResolvedValue([
        {
          netid: 'ADMIN2',
          history: [
            { action: 'granted', actorNetid: 'root1', note: 'onboarded', at: '2026-01-01' },
          ],
        },
        {
          netid: 'admin3',
          history: [
            { action: 'granted', actorNetid: 'root1', note: 'temp', at: '2026-02-01' },
            { action: 'revoked', actorNetid: 'root1', note: 'off-boarded', at: '2026-03-01' },
          ],
        },
      ]),
    };
    vi.spyOn(AdminGrant, 'find')
      .mockReturnValueOnce(activeChain)
      .mockReturnValueOnce(allHistoryChain);

    const userSummaryChain: any = {
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    };
    const legacyChain: any = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(User, 'find').mockReturnValueOnce(userSummaryChain).mockReturnValueOnce(legacyChain);

    const result = await listAdminGrants();

    expect(result.history).toHaveLength(3);
    expect(result.history[0]).toMatchObject({
      action: 'revoked',
      subjectNetid: 'admin3',
      note: 'off-boarded',
    });
    expect(result.history[2]).toMatchObject({ action: 'granted', subjectNetid: 'admin2' });
  });
});
