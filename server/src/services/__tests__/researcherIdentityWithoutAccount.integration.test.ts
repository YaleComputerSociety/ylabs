import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account } from '../../models/account';
import { AdminGrant } from '../../models/adminGrant';
import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import { Researcher } from '../../models/researcher';
import { recordAccountLogin, resolveReporterIdentityByNetid } from '../accountService';
import { clearAdminGrantCache, listAdminGrants } from '../adminGrantService';
import { getAnalytics, getUserAnalytics, invalidateAnalyticsCaches } from '../analyticsService';
import { researchEntityExists } from '../researchAnalytics';

let memoryServer: MongoMemoryServer | undefined;

const RESEARCHER_NETID = 'rsch01';
const RESEARCHER_EMAIL = 'first.researcher@yale.edu';
const RESEARCHER_NAME = 'First Researcher';

const seedResearcherWithoutAccount = () =>
  Researcher.create({
    displayName: RESEARCHER_NAME,
    identifiers: { netid: RESEARCHER_NETID, email: RESEARCHER_EMAIL },
  });

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('researcher_identity_without_account_test'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer?.stop();
});

describe('researcher identity read from the researcher row, with no account behind it', () => {
  beforeEach(async () => {
    invalidateAnalyticsCaches();
    clearAdminGrantCache();
    await Promise.all([
      Account.deleteMany({}),
      Researcher.deleteMany({}),
      AdminGrant.collection.deleteMany({}),
      AnalyticsEvent.collection.deleteMany({}),
    ]);
  });

  it('summarizes an admin grant from the researcher who holds the netid', async () => {
    await seedResearcherWithoutAccount();
    await AdminGrant.collection.insertOne({
      netid: RESEARCHER_NETID,
      status: 'active',
      grantedBy: 'grantor1',
      grantedAt: new Date(),
    });

    const { grants } = await listAdminGrants();

    expect(grants[0].user).toEqual({
      netid: RESEARCHER_NETID,
      email: RESEARCHER_EMAIL,
      displayName: RESEARCHER_NAME,
    });
  });

  it('still summarizes an admin grant through the account a researcher links', async () => {
    const account = await Account.create({ netid: 'acct01', email: 'acct01@yale.edu' });
    await Researcher.create({ displayName: 'Linked Researcher', accountId: account._id });
    await AdminGrant.collection.insertOne({
      netid: 'acct01',
      status: 'active',
      grantedBy: 'grantor1',
      grantedAt: new Date(),
    });

    const { grants } = await listAdminGrants();

    expect(grants[0].user).toEqual({
      netid: 'acct01',
      email: 'acct01@yale.edu',
      displayName: 'Linked Researcher',
    });
  });

  it('names a top-viewed profile from the researcher who holds the netid', async () => {
    await seedResearcherWithoutAccount();
    await AnalyticsEvent.collection.insertMany(
      ['stud01', 'stud02', 'stud03'].map((netid) => ({
        netid,
        userType: 'undergraduate',
        eventType: AnalyticsEventType.RESEARCH_PROFILE_OPEN,
        entityType: 'profile',
        entityId: RESEARCHER_NETID,
        timestamp: new Date(),
      })),
    );

    const analytics = await getAnalytics();
    const profile = analytics.research.topEntities.find(
      (entity: any) => entity.entityType === 'profile',
    );

    expect(profile).toMatchObject({ entityId: RESEARCHER_NETID, name: RESEARCHER_NAME });
  });

  it('names an analytics user from the researcher holding the netid when no researcher links the account', async () => {
    await seedResearcherWithoutAccount();
    await Account.create({
      netid: RESEARCHER_NETID,
      email: RESEARCHER_EMAIL,
      lastLoginAt: new Date(),
    });
    await AnalyticsEvent.collection.insertOne({
      netid: RESEARCHER_NETID,
      userType: 'professor',
      eventType: AnalyticsEventType.LOGIN,
      timestamp: new Date(),
    });

    const { users } = await getUserAnalytics();

    expect(users.find((user) => user.netid === RESEARCHER_NETID)?.displayName).toBe(
      RESEARCHER_NAME,
    );
  });

  it('accepts a profile journey event for a netid only a live researcher holds', async () => {
    await seedResearcherWithoutAccount();
    await Researcher.create({
      displayName: 'Archived Researcher',
      identifiers: { netid: 'arch01' },
      archived: true,
    });

    await expect(researchEntityExists('profile', RESEARCHER_NETID)).resolves.toBe(true);
    await expect(researchEntityExists('profile', 'arch01')).resolves.toBe(false);
    await expect(researchEntityExists('profile', 'nobody1')).resolves.toBe(false);
  });

  it('names a signed-in reporter from the researcher holding the netid', async () => {
    await seedResearcherWithoutAccount();
    await Account.create({
      netid: RESEARCHER_NETID,
      email: 'login.address@yale.edu',
      lastLoginAt: new Date(),
    });

    await expect(resolveReporterIdentityByNetid(RESEARCHER_NETID)).resolves.toEqual({
      email: 'login.address@yale.edu',
      name: RESEARCHER_NAME,
    });
  });

  it('gives no reporter identity for a netid with no account, because a reporter is signed in', async () => {
    await seedResearcherWithoutAccount();

    await expect(resolveReporterIdentityByNetid(RESEARCHER_NETID)).resolves.toEqual({
      email: '',
      name: '',
    });
  });
});

describe('a login settles an unconfirmed account status', () => {
  beforeEach(async () => {
    await Account.deleteMany({});
  });

  it('activates an UNKNOWN account its person signs into', async () => {
    await Account.create({ netid: 'unkn01', email: 'unkn01@yale.edu', status: 'UNKNOWN' });

    const account = await recordAccountLogin({ netid: 'unkn01' });

    expect(account.status).toBe('ACTIVE');
    expect((await Account.findOne({ netid: 'unkn01' }).lean())?.status).toBe('ACTIVE');
  });

  it('never re-enables a DISABLED account on login', async () => {
    await Account.create({ netid: 'disa01', email: 'disa01@yale.edu', status: 'DISABLED' });

    const account = await recordAccountLogin({ netid: 'disa01' });

    expect(account.status).toBe('DISABLED');
    expect((await Account.findOne({ netid: 'disa01' }).lean())?.status).toBe('DISABLED');
  });

  it('creates a first-time login as ACTIVE', async () => {
    const account = await recordAccountLogin({ netid: 'newb01' });

    expect(account.status).toBe('ACTIVE');
    expect((await Account.findOne({ netid: 'newb01' }).lean())?.lastLoginAt).toBeInstanceOf(Date);
  });
});
