import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminGrant } from '../../models/adminGrant';
import { User } from '../../models/user';
import {
  grantAdminAccess,
  isAdminNetid,
  listAdminAccess,
  revokeAdminAccess,
} from '../adminAccessService';

vi.mock('../../models/adminGrant', () => ({
  AdminGrant: {
    create: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../../models/user', () => ({
  User: {
    find: vi.fn(),
    findOne: vi.fn(),
  },
}));

const mockedAdminGrant = vi.mocked(AdminGrant);
const mockedUser = vi.mocked(User);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adminAccessService', () => {
  it('treats an active admin grant as admin authority', async () => {
    vi.mocked(mockedAdminGrant.findOne).mockResolvedValue({ netid: 'fixture-admin' } as any);

    await expect(isAdminNetid('fixture-admin')).resolves.toBe(true);
    expect(mockedAdminGrant.findOne).toHaveBeenCalledWith({
      netid: 'fixture-admin',
      status: 'active',
    });
  });

  it('does not treat missing or revoked grants as admin authority', async () => {
    vi.mocked(mockedAdminGrant.findOne).mockResolvedValue(null);

    await expect(isAdminNetid('fixture-admin')).resolves.toBe(false);
  });

  it('allows the local dev admin fixture outside production without a DB grant', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    vi.mocked(mockedAdminGrant.findOne).mockResolvedValue(null);

    await expect(isAdminNetid('devadmin')).resolves.toBe(true);

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('lists active grants and legacy admin rows without active grants', async () => {
    const grantRows = [
      {
        netid: 'fixture-admin',
        status: 'active',
        source: 'manual',
        grantedAt: new Date('2026-05-25T12:00:00.000Z'),
      },
    ];
    const legacyRows = [
      {
        netid: 'fixture-legacy-admin',
        fname: 'Fixture',
        lname: 'Legacy',
        email: 'fixture-legacy-admin@example.invalid',
        userType: 'admin',
      },
    ];

    vi.mocked(mockedAdminGrant.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(grantRows),
      }),
    } as any);
    vi.mocked(mockedUser.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(legacyRows),
      }),
    } as any);

    await expect(listAdminAccess()).resolves.toMatchObject({
      activeCount: 1,
      grants: [{ netid: 'fixture-admin', status: 'active' }],
      legacyAdminsWithoutGrant: [{ netid: 'fixture-legacy-admin' }],
    });
  });

  it('grants admin access to an existing user with audit metadata', async () => {
    vi.mocked(mockedUser.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          netid: 'fixture-target',
          fname: 'Fixture',
          lname: 'Target',
          email: 'fixture-target@example.invalid',
        }),
      }),
    } as any);
    vi.mocked(mockedAdminGrant.findOne).mockResolvedValue(null);
    vi.mocked(mockedAdminGrant.create).mockResolvedValue({
      netid: 'fixture-target',
      status: 'active',
      source: 'manual',
      grantedBy: 'fixture-actor',
      note: 'Temporary access',
    } as any);

    await expect(
      grantAdminAccess({
        netid: 'Fixture-Target',
        actorNetid: 'fixture-actor',
        note: '  Temporary access  ',
      }),
    ).resolves.toMatchObject({
      netid: 'fixture-target',
      status: 'active',
      source: 'manual',
      grantedBy: 'fixture-actor',
      note: 'Temporary access',
    });

    expect(mockedUser.findOne).toHaveBeenCalledWith({ netid: 'fixture-target' });
    expect(mockedAdminGrant.findOne).toHaveBeenCalledWith({
      netid: 'fixture-target',
      status: 'active',
    });
    expect(mockedAdminGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        netid: 'fixture-target',
        status: 'active',
        source: 'manual',
        grantedBy: 'fixture-actor',
        note: 'Temporary access',
      }),
    );
  });

  it('rejects admin grants for unknown users', async () => {
    vi.mocked(mockedUser.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as any);

    await expect(
      grantAdminAccess({ netid: 'fixture-missing', actorNetid: 'fixture-actor' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockedAdminGrant.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate active admin grants', async () => {
    vi.mocked(mockedUser.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ netid: 'fixture-target' }),
      }),
    } as any);
    vi.mocked(mockedAdminGrant.findOne).mockResolvedValue({
      netid: 'fixture-target',
      status: 'active',
    } as any);

    await expect(
      grantAdminAccess({ netid: 'fixture-target', actorNetid: 'fixture-actor' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockedAdminGrant.create).not.toHaveBeenCalled();
  });

  it('revokes an active admin grant with audit metadata', async () => {
    vi.mocked(mockedAdminGrant.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        netid: 'fixture-target',
        status: 'revoked',
        revokedBy: 'fixture-actor',
        note: 'No longer needed',
      }),
    } as any);

    await expect(
      revokeAdminAccess({
        netid: 'fixture-target',
        actorNetid: 'fixture-actor',
        note: ' No longer needed ',
      }),
    ).resolves.toMatchObject({
      netid: 'fixture-target',
      status: 'revoked',
      revokedBy: 'fixture-actor',
      note: 'No longer needed',
    });

    expect(mockedAdminGrant.findOneAndUpdate).toHaveBeenCalledWith(
      { netid: 'fixture-target', status: 'active' },
      expect.objectContaining({
        status: 'revoked',
        revokedBy: 'fixture-actor',
        note: 'No longer needed',
      }),
      { new: true, runValidators: true },
    );
  });

  it('blocks self-revocation', async () => {
    await expect(
      revokeAdminAccess({ netid: 'fixture-actor', actorNetid: 'fixture-actor' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockedAdminGrant.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns not found when revoking a missing active grant', async () => {
    vi.mocked(mockedAdminGrant.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);

    await expect(
      revokeAdminAccess({ netid: 'fixture-target', actorNetid: 'fixture-actor' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
