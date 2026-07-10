import { describe, expect, it } from 'vitest';
import { User, normalizeUserType } from '../user';

describe('User userType normalization', () => {
  it('stores legacy faculty user types as professor', async () => {
    const user = new User({
      netid: 'faculty.fixture',
      email: 'faculty.fixture@yale.edu',
      fname: 'Faculty',
      lname: 'Fixture',
      userType: 'faculty',
    });

    await expect(user.validate()).resolves.toBeUndefined();
    expect(user.userType).toBe('professor');
  });

  it('normalizes faculty without keeping it in the stored enum', () => {
    const enumValues = User.schema.path('userType').options.enum;

    expect(normalizeUserType('faculty')).toBe('professor');
    expect(enumValues).toContain('professor');
    expect(enumValues).not.toContain('faculty');
  });
});
