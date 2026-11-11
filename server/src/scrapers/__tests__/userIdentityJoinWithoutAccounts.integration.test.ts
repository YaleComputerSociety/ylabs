import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
  joinUserIdentityToExistingResearcher,
  resolveNetidForRosterEmailAlias,
} from '../entityMaterializer';
import { clearC4Flags } from './c4FlagTestEnv';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';

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
      identifiers: { netid: 'fixtureunit', email: 'fixture.contact@yale.edu' },
    });
    const key = 'netid:fixtureunit';
    const unitPage = (field: string, value: unknown) => ({
      ...userObservation(key, field, value),
      sourceUrl: 'https://fixtureunit.yale.edu/profile/rowan-synthetic',
    });
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      unitPage('netid', 'fixtureunit'),
      unitPage('email', 'fixture.contact@yale.edu'),
      unitPage('fname', 'Rowan'),
      unitPage('lname', 'Synthetic'),
    ]);

    expect(join.researcher).toBeNull();
    expect(join.netid).toBeUndefined();
    expect(join.displayName).toBe('');
  });

  it('refuses a name match when the evidence spells out a different netid than the candidate holds', async () => {
    const key = 'netid:quinn.synthetic.qs584';
    const pageObservation = (field: string, value: unknown) => ({
      ...userObservation(key, field, value),
      sourceUrl: 'https://medicine.yale.edu/profile/quinn-synthetic-qs584/',
    });
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      pageObservation('netid', 'quinn.synthetic.qs584'),
      pageObservation('fname', 'Quinn'),
      pageObservation('lname', 'Synthetic'),
      pageObservation('title', 'Staff Affiliate'),
      pageObservation('profileUrls', {
        departmental: 'https://medicine.yale.edu/profile/quinn-synthetic-qs584/',
      }),
    ]);

    expect(join.researcher).toBeNull();
    expect(join.identityJoin).toBeUndefined();
  });

  it('still name-matches when the evidence spells out the netid the candidate holds', async () => {
    const key = `netid:quinn.synthetic.${NETID}`;
    const join = await joinUserIdentityToExistingResearcher({ entityKey: key }, [
      userObservation(key, 'fname', 'Quinn'),
      userObservation(key, 'lname', 'Synthetic'),
    ]);

    expect(String(join.researcher?._id)).toBe(String(researcherId));
    expect(join.identityJoin).toBe('person-name');
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

    it('stays on the alias holder, by name rather than netid, when the directory map names someone else', async () => {
      const holder = await Researcher.create({
        displayName: 'Quinn Alias',
        identifiers: { netid: ALIAS },
      });
      await Researcher.create({ displayName: 'Morgan Other', identifiers: { netid: REAL } });
      await seedAliasMap();

      const join = await joinUserIdentityToExistingResearcher({ entityKey: `netid:${ALIAS}` }, [
        userObservation(`netid:${ALIAS}`, 'fname', 'Quinn'),
        userObservation(`netid:${ALIAS}`, 'lname', 'Alias'),
      ]);

      expect(String(join.researcher?._id)).toBe(String(holder._id));
      expect(join.identityJoin).toBe('person-name');
    });
  });

  describe('an email local part stamped as a researcher netid', () => {
    const ALIAS = 'robin.fixture';
    const ALIAS_KEY = `netid:${ALIAS}`;
    const REAL = 'abc123';

    it('is not an identity netid, so it reaches nobody on the netid join', async () => {
      await Researcher.create({ displayName: 'Robin Fixture', identifiers: { netid: ALIAS } });
      const join = await joinUserIdentityToExistingResearcher({ entityKey: ALIAS_KEY }, [
        userObservation(ALIAS_KEY, 'netid', ALIAS),
      ]);

      expect(join.identityJoin).not.toBe('account-netid');
      expect(join.researcher).toBeNull();
    });

    const aliasMapEntry = (entityKey: string) =>
      Observation.create({
        entityType: 'user',
        entityKey,
        field: 'email',
        value: `${ALIAS}@yale.edu`,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'directory-alias-resolution',
        confidence: 0.9,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        superseded: false,
      });

    it('never resolves an alias to another alias key, but resolves it to a netid (#5740)', async () => {
      await aliasMapEntry(`netid:${ALIAS}.second`);
      expect(await resolveNetidForRosterEmailAlias(ALIAS)).toEqual({ status: 'absent' });

      await aliasMapEntry(`netid:${REAL}`);
      expect(await resolveNetidForRosterEmailAlias(ALIAS)).toEqual({
        status: 'resolved',
        netid: REAL,
      });
    });

    it('still reaches the holder the directory maps the alias to', async () => {
      await Researcher.create({ displayName: 'Robin Fixture', identifiers: { netid: ALIAS } });
      const real = await Researcher.create({
        displayName: 'Robin Fixture',
        identifiers: { netid: REAL },
      });
      await Observation.create({
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
      const join = await joinUserIdentityToExistingResearcher({ entityKey: ALIAS_KEY }, [
        userObservation(ALIAS_KEY, 'netid', ALIAS),
      ]);

      expect(join.identityJoin).toBe('account-netid');
      expect(String(join.researcher?._id)).toBe(String(real._id));
    });
  });

  describe('a name match the Yale directory pairs with another netid', () => {
    const CANDIDATE_NETID = 'abc123';
    const OTHER_NETID = 'rf456';
    const KEY = 'netid:robin.fixture';
    const KEY_EMAIL = 'robin.fixture@yale.edu';

    const directoryPairs = (netid: string, email: string) =>
      Observation.create({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'email',
        value: email,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'yale-directory',
        confidence: 0.95,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        superseded: false,
      });

    const joinKey = (displayName: string, email?: string) =>
      joinUserIdentityToExistingResearcher({ entityKey: KEY }, [
        userObservation(KEY, 'displayName', displayName),
        ...(email ? [userObservation(KEY, 'email', email)] : []),
      ]);

    let candidateId: mongoose.Types.ObjectId;

    beforeEach(async () => {
      resetDirectoryNetidsByAddressCache();
      candidateId = (
        await Researcher.create({
          displayName: 'Robin A. Fixture',
          identifiers: { netid: CANDIDATE_NETID, email: `${CANDIDATE_NETID}@yale.edu` },
        })
      )._id;
      await directoryPairs(CANDIDATE_NETID, `${CANDIDATE_NETID}@yale.edu`);
    });

    afterEach(() => resetDirectoryNetidsByAddressCache());

    it('does not join a namesake whose own email the directory gives to another netid', async () => {
      await directoryPairs(OTHER_NETID, KEY_EMAIL);

      const join = await joinKey('Robin Fixture', KEY_EMAIL);

      expect(join.identityJoin).toBeUndefined();
      expect(join.researcher).toBeNull();
    });

    it('still joins a short form of the same person whose email the directory gives to the candidate', async () => {
      await directoryPairs(CANDIDATE_NETID, KEY_EMAIL);

      const join = await joinKey('Robin Fixture', KEY_EMAIL);

      expect(String(join.researcher?._id)).toBe(String(candidateId));
      expect(join.identityJoin).toBe('person-name');
    });

    it('joins by name as before when the directory pairs the email with nobody', async () => {
      const join = await joinKey('Robin Fixture', KEY_EMAIL);

      expect(String(join.researcher?._id)).toBe(String(candidateId));
      expect(join.identityJoin).toBe('person-name');
    });
  });
});
