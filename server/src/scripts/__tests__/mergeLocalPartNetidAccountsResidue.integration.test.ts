import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import {
  LONE_LOCAL_PART_ARCHIVED_REASON,
  planLocalPartNetidMerges,
  applyLoneLocalPartArchives,
  planLoneLocalPartArchives,
} from '../mergeLocalPartNetidAccountsCore';
import { parseMergeLocalPartNetidAccountsArgs } from '../mergeLocalPartNetidAccounts';

const oid = () => new mongoose.Types.ObjectId();
const created = new Date('2026-08-27T21:00:00Z');

function accountRow(netid: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    schemaVersion: 1,
    netid,
    email,
    status: 'ACTIVE',
    archived: false,
    createdAt: created,
    updatedAt: created,
    ...extra,
  };
}

function researcherRow(
  accountId: mongoose.Types.ObjectId,
  displayName: string,
  extra: Record<string, unknown> = {},
) {
  return {
    _id: oid(),
    schemaVersion: 1,
    displayName,
    accountId,
    profileLinks: [],
    status: 'UNKNOWN',
    archived: false,
    ...extra,
  };
}

describe('the account residue left after the local-part twin merge (#4917)', () => {
  let server: MongoMemoryServer;
  let db: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    db = mongoose.connection.db!;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await db.dropDatabase();
  });

  it('holds a pair whose accounts both link a researcher, because no scope folds the researchers (#4924)', async () => {
    const localPart = accountRow('alpha.fixture', 'alpha.fixture@yale.edu');
    const netid = accountRow('af1001', 'alpha.fixture@yale.edu');
    await db.collection('accounts').insertMany([localPart, netid]);
    await db
      .collection('researchers')
      .insertMany([
        researcherRow(localPart._id, 'Avery Q. Fixture'),
        researcherRow(netid._id, 'Avery Fixture'),
      ]);

    const plan = await planLocalPartNetidMerges(db);
    expect(plan.merges).toHaveLength(0);
    expect(plan.refusals['both-accounts-link-a-researcher']).toBe(1);
    expect(await db.collection('researchers').countDocuments({ archived: true })).toBe(0);
  });

  it('archives a lone local-part account only when it holds nothing, and holds the rest', async () => {
    const empty = accountRow('gamma.fixture', 'gamma.fixture@yale.edu');
    const linked = accountRow('delta.fixture', 'delta.fixture@yale.edu');
    const loggedIn = accountRow('epsilon.fixture', 'epsilon.fixture@yale.edu', {
      lastLoginAt: created,
    });
    const planner = accountRow('zeta.fixture', 'zeta.fixture@yale.edu');
    const reviewer = accountRow('eta.fixture', 'eta.fixture@yale.edu');
    const admin = accountRow('theta.fixture', 'theta.fixture@yale.edu');
    const wellShaped = accountRow('wf1009', 'wf1009@yale.edu');
    await db
      .collection('accounts')
      .insertMany([empty, linked, loggedIn, planner, reviewer, admin, wellShaped]);
    await db.collection('researchers').insertOne(researcherRow(linked._id, 'Dana Fixture'));
    await db.collection('research_plans').insertOne({
      _id: oid(),
      accountId: planner._id,
      target: { kind: 'RESEARCH_ENTITY', id: oid() },
    });
    await db.collection('research_entities').insertOne({
      _id: oid(),
      slug: 'synthetic-row',
      studentVisibilityReviewedByAccountId: reviewer._id,
    });
    await db.collection('admin_grants').insertOne({ netid: admin.netid, status: 'ACTIVE' });

    const plan = await planLoneLocalPartArchives(db);
    expect(plan.loneLocalPartAccounts).toBe(6);
    expect(plan.archives.map(String)).toEqual([String(empty._id)]);
    expect(plan.held).toMatchObject({
      'linked-to-a-researcher': 1,
      'has-login': 1,
      'holds-research-plan': 1,
      'holds-reviewer-stamp': 1,
      'holds-admin-grant': 1,
    });

    expect((await applyLoneLocalPartArchives(db, plan.archives, created)).archived).toBe(1);
    const archived = await db.collection('accounts').findOne({ _id: empty._id });
    expect(archived).toMatchObject({
      archived: true,
      archivedReason: LONE_LOCAL_PART_ARCHIVED_REASON,
      archivedAt: created,
    });
    expect(archived?.mergedIntoAccountId).toBeUndefined();
    expect(await db.collection('accounts').countDocuments({})).toBe(7);
    expect((await planLoneLocalPartArchives(db)).archives).toEqual([]);
  });

  it('defaults to the account-twin scope and parses the residue scope', () => {
    expect(parseMergeLocalPartNetidAccountsArgs([]).scope).toBe('account-twins');
    expect(parseMergeLocalPartNetidAccountsArgs(['--scope', 'lone-accounts']).scope).toBe(
      'lone-accounts',
    );
    expect(() => parseMergeLocalPartNetidAccountsArgs(['--scope=researcher-twins'])).toThrow(
      /--scope/,
    );
    expect(() => parseMergeLocalPartNetidAccountsArgs(['--scope=everything'])).toThrow(/--scope/);
  });
});
