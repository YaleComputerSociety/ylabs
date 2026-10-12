import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPostMaterializationIntegrityGate } from '../integrityGate';

describe('runPostMaterializationIntegrityGate duplicate netid detection', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
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

  it('surfaces a netid two researchers hold with no account rows at all (#5000)', async () => {
    const db = mongoose.connection.db!;
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertMany([
      { _id: first, displayName: 'Ada Fixture', archived: false, identifiers: { netid: 'af3' } },
      { _id: second, displayName: 'Ada Fixture', archived: false, identifiers: { netid: 'af3' } },
    ]);

    const groups = await netidGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].userIds.sort()).toEqual([String(first), String(second)].sort());
  });

  it('reads the netid a researcher holds ahead of the netid on its linked account', async () => {
    const db = mongoose.connection.db!;
    const accountId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({ _id: accountId, netid: 'old9', archived: false });
    await db.collection('researchers').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        displayName: 'Ada Fixture',
        accountId,
        archived: false,
        identifiers: { netid: 'af3' },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        displayName: 'Other Fixture',
        archived: false,
        identifiers: { netid: 'old9' },
      },
    ]);

    expect(await netidGroups()).toEqual([]);
  });
});

describe('runPostMaterializationIntegrityGate duplicate email detection', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    await db.collection('researchers').deleteMany({});
    await db.collection('accounts').deleteMany({});
  });

  const emailGroups = async () => {
    const summary = await runPostMaterializationIntegrityGate({ includeSamples: true, limit: 25 });
    return summary.samples.duplicatePeople.filter((group) => group.identityField === 'email');
  };

  it('surfaces an email two researchers hold with no account rows at all (#5000)', async () => {
    const db = mongoose.connection.db!;
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertMany([
      {
        _id: first,
        displayName: 'Ada Fixture',
        archived: false,
        identifiers: { email: 'ada.fixture@example.test' },
      },
      {
        _id: second,
        displayName: 'Ada Fixture',
        archived: false,
        identifiers: { email: 'Ada.Fixture@example.test' },
      },
    ]);

    const groups = await emailGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].identityValue).toBe('ada.fixture@example.test');
    expect(groups[0].userIds.sort()).toEqual([String(first), String(second)].sort());
  });

  it('falls back to the linked account email for a researcher that holds none', async () => {
    const db = mongoose.connection.db!;
    const accountId = new mongoose.Types.ObjectId();
    const holder = new mongoose.Types.ObjectId();
    const linked = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: accountId,
      email: 'ada.fixture@example.test',
      archived: false,
    });
    await db.collection('researchers').insertMany([
      {
        _id: holder,
        displayName: 'Ada Fixture',
        archived: false,
        identifiers: { email: 'ada.fixture@example.test' },
      },
      { _id: linked, displayName: 'Ada Fixture', accountId, archived: false, identifiers: {} },
    ]);

    const groups = await emailGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].userIds.sort()).toEqual([String(holder), String(linked)].sort());
  });

  it('counts a researcher once when it holds the same email as its linked account', async () => {
    const db = mongoose.connection.db!;
    const accountId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: accountId,
      email: 'ada.fixture@example.test',
      archived: false,
    });
    await db.collection('researchers').insertOne({
      displayName: 'Ada Fixture',
      accountId,
      archived: false,
      identifiers: { email: 'ada.fixture@example.test' },
    });

    expect(await emailGroups()).toEqual([]);
  });

  it('ignores accounts that share an email but back no live researcher', async () => {
    const db = mongoose.connection.db!;
    await db.collection('accounts').insertMany([
      { email: 'shared@example.test', archived: false },
      { email: 'shared@example.test', archived: false },
    ]);

    expect(await emailGroups()).toEqual([]);
  });
});
