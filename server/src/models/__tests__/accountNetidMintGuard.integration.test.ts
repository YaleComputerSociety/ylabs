import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account, UnmintableAccountNetidError } from '../account';

const LOCAL_PART = 'synthetic.person';
const NETID = 'zz9999';
const EMAIL = 'synthetic.person@yale.edu';

describe('an account is never minted under a key that is not a netid (#4773)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await Account.deleteMany({});
  });

  it('refuses the 2026-08-27 shape: an upsert keyed on an email local part with no validators', async () => {
    await expect(
      Account.findOneAndUpdate(
        { netid: LOCAL_PART },
        { $set: { email: EMAIL }, $setOnInsert: { status: 'ACTIVE' } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ),
    ).rejects.toBeInstanceOf(UnmintableAccountNetidError);
    expect(await Account.countDocuments({})).toBe(0);
  });

  it('refuses the same key through create, insertMany, updateOne upsert and a $set', async () => {
    await expect(Account.create({ netid: LOCAL_PART, email: EMAIL })).rejects.toBeInstanceOf(
      UnmintableAccountNetidError,
    );
    await expect(Account.insertMany([{ netid: LOCAL_PART, email: EMAIL }])).rejects.toBeInstanceOf(
      UnmintableAccountNetidError,
    );
    await expect(
      Account.updateOne(
        { email: EMAIL },
        { $setOnInsert: { netid: LOCAL_PART, email: EMAIL } },
        { upsert: true },
      ),
    ).rejects.toBeInstanceOf(UnmintableAccountNetidError);
    await Account.create({ netid: NETID, email: EMAIL });
    await expect(
      Account.updateOne({ netid: NETID }, { $set: { netid: LOCAL_PART } }),
    ).rejects.toBeInstanceOf(UnmintableAccountNetidError);
    expect(await Account.countDocuments({ netid: LOCAL_PART })).toBe(0);
  });

  it('still mints a netid and still updates or archives an already stored local-part row', async () => {
    await Account.findOneAndUpdate(
      { netid: NETID },
      { $setOnInsert: { netid: NETID, email: EMAIL, status: 'ACTIVE' } },
      { upsert: true },
    );
    await Account.collection.insertOne({
      netid: LOCAL_PART,
      email: EMAIL,
      status: 'ACTIVE',
      archived: false,
    });
    await Account.updateOne(
      { netid: LOCAL_PART },
      { $set: { archived: true, archivedReason: 'merged-local-part-netid-twin' } },
    );
    expect(await Account.countDocuments({ netid: NETID })).toBe(1);
    expect(await Account.countDocuments({ netid: LOCAL_PART, archived: true })).toBe(1);
  });
});
