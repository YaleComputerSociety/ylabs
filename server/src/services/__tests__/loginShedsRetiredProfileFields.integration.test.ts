import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account } from '../../models/account';
import { recordAccountLogin } from '../accountService';

let memoryServer: MongoMemoryServer | undefined;

const RETIRED_PATHS = ['college', 'year', 'major'] as const;

const accountCarryingRetiredProfileFields = (netid: string) => ({
  netid,
  email: `${netid}@example.invalid`,
  status: 'ACTIVE',
  archived: false,
  schemaVersion: 1,
  profile: {
    firstName: 'Synthetic',
    lastName: 'Student',
    userType: 'undergraduate',
    college: 'A Synthetic College',
    year: '2029',
    major: ['Synthetic Studies'],
  },
});

const storedProfile = async (netid: string): Promise<Record<string, unknown>> => {
  const stored = await Account.collection.findOne({ netid });
  return (stored?.profile as Record<string, unknown>) ?? {};
};

describe('a login sheds the retired profile fields from a stored account', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('login_sheds_retired_profile_fields_test'));
  });

  beforeEach(async () => {
    await Account.collection.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('removes them when the login resolves a record and writes a profile', async () => {
    await Account.collection.insertOne(accountCarryingRetiredProfileFields('resolved1'));

    await recordAccountLogin({
      netid: 'resolved1',
      profile: { firstName: 'Synthetic', lastName: 'Student', userType: 'undergraduate' },
    });

    const profile = await storedProfile('resolved1');
    expect(profile.userType).toBe('undergraduate');
    for (const retired of RETIRED_PATHS) expect(profile).not.toHaveProperty(retired);
  });

  it('removes them when the lookup was unavailable and the login writes no profile', async () => {
    await Account.collection.insertOne(accountCarryingRetiredProfileFields('unavailable1'));

    await recordAccountLogin({ netid: 'unavailable1' });

    const profile = await storedProfile('unavailable1');
    expect(profile.firstName).toBe('Synthetic');
    expect(profile.userType).toBe('undergraduate');
    for (const retired of RETIRED_PATHS) expect(profile).not.toHaveProperty(retired);
  });

  it('creates a new account with none of them', async () => {
    await recordAccountLogin({
      netid: 'brandnew1',
      email: 'brandnew1@example.invalid',
      profile: { firstName: 'Synthetic', lastName: 'Student', userType: 'undergraduate' },
    });

    const profile = await storedProfile('brandnew1');
    expect(Object.keys(profile).sort()).toEqual(['firstName', 'lastName', 'userType']);
  });
});
