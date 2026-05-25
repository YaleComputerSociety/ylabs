import { describe, expect, it, vi } from 'vitest';

import { backfillAdminGrants } from '../backfillAdminGrantsCore';

describe('backfillAdminGrants', () => {
  it('dry-runs legacy admin grant candidates without writing', async () => {
    const createGrant = vi.fn();
    const result = await backfillAdminGrants({
      apply: false,
      users: [
        {
          netid: 'fixture-admin',
          email: 'fixture-admin@example.invalid',
          fname: 'Fixture',
          lname: 'Admin',
          userType: 'admin',
        },
      ],
      existingActiveGrantNetids: new Set(),
      createGrant,
      now: new Date('2026-05-25T12:00:00.000Z'),
    });

    expect(result).toEqual({
      apply: false,
      created: [],
      skippedExisting: [],
      skippedFixtures: [],
      candidates: ['fixture-admin'],
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it('creates grants for non-fixture legacy admins and skips fixture accounts', async () => {
    const createGrant = vi.fn();
    const result = await backfillAdminGrants({
      apply: true,
      users: [
        {
          netid: 'fixture-admin',
          email: 'fixture-admin@example.invalid',
          fname: 'Fixture',
          lname: 'Admin',
          userType: 'admin',
        },
        {
          netid: 'devadmin',
          email: 'devadmin@example.test',
          fname: 'Dev',
          lname: 'Admin',
          userType: 'admin',
        },
      ],
      existingActiveGrantNetids: new Set(),
      createGrant,
      now: new Date('2026-05-25T12:00:00.000Z'),
    });

    expect(result.created).toEqual(['fixture-admin']);
    expect(result.skippedFixtures).toEqual(['devadmin']);
    expect(createGrant).toHaveBeenCalledWith({
      netid: 'fixture-admin',
      status: 'active',
      source: 'migration',
      grantedAt: new Date('2026-05-25T12:00:00.000Z'),
      note: 'Backfilled from legacy users.userType=admin.',
    });
  });
});
