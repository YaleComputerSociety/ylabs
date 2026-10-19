import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { joinUserIdentityToExistingResearcher } from '../entityMaterializer';
import { clearC4Flags } from './c4FlagTestEnv';

const NETID = 'qz901';
const EMAIL = 'quinn.synthetic901@yale.edu';

const userObservation = (entityKey: string, field: string, value: unknown) => ({
  entityType: 'user',
  entityKey,
  field,
  value,
  sourceName: 'dept-faculty-roster',
  sourceUrl: 'https://fixture-dept.yale.edu/people/',
  confidence: 0.8,
  observedAt: new Date('2026-09-01T00:00:00Z'),
});

describe('the user identity join reads researcher identifiers when no account exists (#5000)', () => {
  let replSet: MongoMemoryReplSet;
  let researcherId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    researcherId = (
      await Researcher.create({
        displayName: 'Quinn Synthetic',
        identifiers: { netid: NETID, email: EMAIL },
      })
    )._id;
  });

  it('reaches the researcher holding the netid', async () => {
    const join = await joinUserIdentityToExistingResearcher({ entityKey: `netid:${NETID}` }, [
      userObservation(`netid:${NETID}`, 'displayName', 'Quinn Synthetic'),
    ]);

    expect(String(join.researcher?._id)).toBe(String(researcherId));
    expect(join.identityJoin).toBe('account-netid');
    expect(await Account.countDocuments({})).toBe(0);
  });

  it('reaches nobody through a key minted from the mailbox of the unit whose pages it cites', async () => {
    await Researcher.create({
      displayName: 'Rowan Synthetic',
      identifiers: { netid: 'fixtureunit', email: 'fixtureunit@yale.edu' },
    });
    const key = 'netid:fixtureunit';
    const unitPage = (field: string, value: unknown) => ({
      ...userObservation(key, field, value),
      sourceUrl: 'https://fixtureunit.yale.edu/profile/rowan-synthetic',
    });
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      unitPage('netid', 'fixtureunit'),
      unitPage('email', 'fixtureunit@yale.edu'),
      unitPage('fname', 'Rowan'),
      unitPage('lname', 'Synthetic'),
    ]);

    expect(join.researcher).toBeNull();
    expect(join.netid).toBeUndefined();
    expect(join.displayName).toBe('');
  });

  it('reaches the researcher holding the email when the key names no netid holder', async () => {
    const key = 'netid:quinn.synthetic';
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      userObservation(key, 'email', EMAIL),
    ]);

    expect(String(join.researcher?._id)).toBe(String(researcherId));
    expect(join.identityJoinedOnEmailAlone).toBe(true);
  });

  it('fails closed on the email when a live login account linked to no researcher also claims it', async () => {
    await Account.create({ netid: 'qz902', email: EMAIL, status: 'ACTIVE' });
    const key = 'netid:quinn.synthetic';
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      userObservation(key, 'email', EMAIL),
    ]);

    expect(join.identityJoinedOnEmailAlone).toBe(false);
    expect(join.researcher).toBeNull();
  });

  it('treats a login account and the researcher linked to it as one claimant of the email', async () => {
    const login = await Account.create({ netid: NETID, email: EMAIL, status: 'ACTIVE' });
    await Researcher.updateOne({ _id: researcherId }, { $set: { accountId: login._id } });
    const key = 'netid:quinn.synthetic';
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      userObservation(key, 'email', EMAIL),
    ]);

    expect(String(join.researcher?._id)).toBe(String(researcherId));
    expect(join.identityJoinedOnEmailAlone).toBe(true);
  });

  describe('an alias held only by a researcher', () => {
    const ALIAS = 'quinn.alias';
    const REAL = 'qz903';

    const seedAliasMap = () =>
      Observation.create({
        entityType: 'user',
        entityKey: `netid:${REAL}`,
        field: 'email',
        value: `${ALIAS}@yale.edu`,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'directory-alias-resolution',
        confidence: 0.9,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        superseded: false,
      });

    const joinAlias = () =>
      joinUserIdentityToExistingResearcher({ entityKey: `netid:${ALIAS}` }, [
        userObservation(`netid:${ALIAS}`, 'title', 'Professor'),
      ]);

    it('redirects to the real netid holder when the two names agree', async () => {
      await Researcher.create({ displayName: 'Quinn R. Alias', identifiers: { netid: ALIAS } });
      const real = await Researcher.create({
        displayName: 'Quinn Alias',
        identifiers: { netid: REAL },
      });
      await seedAliasMap();

      const join = await joinAlias();

      expect(String(join.researcher?._id)).toBe(String(real._id));
    });

    it('stays on the alias holder when the directory map names someone else', async () => {
      const holder = await Researcher.create({
        displayName: 'Quinn Alias',
        identifiers: { netid: ALIAS },
      });
      await Researcher.create({ displayName: 'Morgan Other', identifiers: { netid: REAL } });
      await seedAliasMap();

      const join = await joinAlias();

      expect(String(join.researcher?._id)).toBe(String(holder._id));
    });
  });
});
