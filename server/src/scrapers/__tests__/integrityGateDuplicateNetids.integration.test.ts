import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPostMaterializationIntegrityGate } from '../integrityGate';

describe('runPostMaterializationIntegrityGate duplicate netid detection', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('researchers').deleteMany({});
    await db.collection('accounts').deleteMany({});
  });

  const netidGroups = async () => {
    const summary = await runPostMaterializationIntegrityGate({ includeSamples: true, limit: 25 });
    return summary.samples.duplicatePeople.filter((group) => group.identityField === 'netid');
  };

  it('surfaces one netid split across an account-backed researcher and an accountless twin', async () => {
    const db = mongoose.connection.db!;
    const accountId = new mongoose.Types.ObjectId();
    const accountBacked = new mongoose.Types.ObjectId();
    const accountlessTwin = new mongoose.Types.ObjectId();

    await db.collection('accounts').insertOne({
      _id: accountId,
      netid: 'jr55',
      email: 'jr55@example.test',
      archived: false,
    });
    await db.collection('researchers').insertMany([
      { _id: accountBacked, displayName: 'Jane Roe', accountId, archived: false },
      {
        _id: accountlessTwin,
        displayName: 'Jane Roe',
        archived: false,
        identifiers: { netid: 'jr55' },
      },
    ]);

    const groups = await netidGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].identityValue).toBe('jr55');
    expect(groups[0].userIds.sort()).toEqual(
      [String(accountBacked), String(accountlessTwin)].sort(),
    );
  });

  it('surfaces case-variant duplicate netids written directly onto researchers', async () => {
    const db = mongoose.connection.db!;
    const lowerCased = new mongoose.Types.ObjectId();
    const upperCased = new mongoose.Types.ObjectId();

    await db.collection('researchers').insertMany([
      {
        _id: lowerCased,
        displayName: 'Nate Netid',
        archived: false,
        identifiers: { netid: 'nn7' },
      },
      {
        _id: upperCased,
        displayName: 'Nate Netid',
        archived: false,
        identifiers: { netid: 'NN7' },
      },
    ]);

    const groups = await netidGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].identityValue).toBe('nn7');
    expect(groups[0].userIds).toHaveLength(2);
  });

  it('reports no netid collision when one researcher holds the netid on both sources', async () => {
    const db = mongoose.connection.db!;
    const accountId = new mongoose.Types.ObjectId();

    await db.collection('accounts').insertOne({
      _id: accountId,
      netid: 'sole1',
      email: 'sole1@example.test',
      archived: false,
    });
    await db.collection('researchers').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        displayName: 'Sole Person',
        accountId,
        archived: false,
        identifiers: { netid: 'sole1' },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        displayName: 'Someone Else',
        archived: false,
        identifiers: {},
      },
    ]);

    expect(await netidGroups()).toEqual([]);
  });

  it('ignores archived researchers so a completed dedupe clears the collision', async () => {
    const db = mongoose.connection.db!;
    const accountId = new mongoose.Types.ObjectId();

    await db.collection('accounts').insertOne({
      _id: accountId,
      netid: 'jr55',
      email: 'jr55@example.test',
      archived: false,
    });
    await db.collection('researchers').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        displayName: 'Jane Roe',
        accountId,
        archived: false,
        identifiers: { netid: 'jr55' },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        displayName: 'Jane Roe',
        archived: true,
        identifiers: { netid: 'jr55' },
      },
    ]);

    expect(await netidGroups()).toEqual([]);
  });
});
