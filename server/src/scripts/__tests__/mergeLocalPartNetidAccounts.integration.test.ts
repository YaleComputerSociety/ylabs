import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { runPostMaterializationIntegrityGate } from '../../scrapers/integrityGate';
import {
  LOCAL_PART_TWIN_ARCHIVED_REASON,
  applyLocalPartNetidMerges,
  isLocalPartAccount,
  planLocalPartNetidMerges,
  projectedSharedEmailGroupsAfterApply,
} from '../mergeLocalPartNetidAccountsCore';
import {
  assertMergeCountWithinCap,
  assertMergeLocalPartNetidAccountsApplyAllowed,
  parseMergeLocalPartNetidAccountsArgs,
} from '../mergeLocalPartNetidAccounts';

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

function researcherRow(accountId: mongoose.Types.ObjectId | undefined, extra = {}) {
  return {
    _id: oid(),
    schemaVersion: 1,
    displayName: 'Synthetic Person',
    profileLinks: [],
    status: 'UNKNOWN',
    archived: false,
    ...(accountId ? { accountId } : {}),
    ...extra,
  };
}

describe('merging accounts minted with an email local part as their netid (#4773)', () => {
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

  async function seed() {
    const mergeable = {
      localPart: accountRow('alpha.fixture', 'alpha.fixture@yale.edu'),
      netid: accountRow('as1001', 'alpha.fixture@yale.edu'),
    };
    const withReferences = {
      localPart: accountRow('beta.fixture', 'beta.fixture@yale.edu'),
      netid: accountRow('bs1002', 'beta.fixture@yale.edu'),
    };
    const bothResearchers = {
      localPart: accountRow('gamma.fixture', 'gamma.fixture@yale.edu'),
      netid: accountRow('gs1003', 'gamma.fixture@yale.edu'),
    };
    const offShape = {
      first: accountRow('ds1004', 'delta.fixture@yale.edu'),
      second: accountRow('ds1005', 'delta.fixture@yale.edu'),
    };
    const loneLocalPart = accountRow('epsilon.fixture', 'epsilon.fixture@yale.edu');
    await db
      .collection('accounts')
      .insertMany([
        mergeable.localPart,
        mergeable.netid,
        withReferences.localPart,
        withReferences.netid,
        bothResearchers.localPart,
        bothResearchers.netid,
        offShape.first,
        offShape.second,
        loneLocalPart,
      ]);
    const movedResearcher = researcherRow(withReferences.localPart._id);
    await db
      .collection('researchers')
      .insertMany([
        researcherRow(mergeable.netid._id),
        movedResearcher,
        researcherRow(bothResearchers.localPart._id),
        researcherRow(bothResearchers.netid._id),
      ]);
    const sharedTarget = { kind: 'RESEARCH_ENTITY', id: oid() };
    const ownTarget = { kind: 'RESEARCH_ENTITY', id: oid() };
    await db.collection('research_plans').insertMany([
      {
        _id: oid(),
        accountId: withReferences.localPart._id,
        target: sharedTarget,
        archived: false,
      },
      { _id: oid(), accountId: withReferences.netid._id, target: sharedTarget, archived: false },
      { _id: oid(), accountId: withReferences.localPart._id, target: ownTarget, archived: false },
    ]);
    const reviewedEntityId = oid();
    await db.collection('research_entities').insertOne({
      _id: reviewedEntityId,
      slug: 'synthetic-entity',
      studentVisibilityReviewedByAccountId: withReferences.localPart._id,
    });
    return { mergeable, withReferences, bothResearchers, movedResearcher, reviewedEntityId };
  }

  it('recognizes a local part only when it is not netid-shaped', () => {
    expect(
      isLocalPartAccount({ netid: 'alpha.fixture', email: 'alpha.fixture@yale.edu' }),
    ).toBe(true);
    expect(isLocalPartAccount({ netid: 'as1001', email: 'as1001@yale.edu' })).toBe(false);
    expect(isLocalPartAccount({ netid: 'alpha.fixture', email: 'other.person@yale.edu' })).toBe(
      false,
    );
  });

  it('plans only unambiguous pairs and reports the rest by reason', async () => {
    await seed();
    const plan = await planLocalPartNetidMerges(db);
    expect(plan.sharedEmailGroups).toBe(4);
    expect(plan.merges).toHaveLength(2);
    expect(plan.refusals['both-accounts-link-a-researcher']).toBe(1);
    expect(plan.refusals['off-shape-pair']).toBe(1);
    expect(plan.localPartAccountsWithoutTwin).toBe(1);
    expect(projectedSharedEmailGroupsAfterApply(plan)).toBe(2);
  });

  it('repoints every account reference, keeps a duplicate plan, archives, and plans 0 on a rerun', async () => {
    const { withReferences, mergeable, movedResearcher, reviewedEntityId } = await seed();
    const before = await runPostMaterializationIntegrityGate();
    expect(before.counts.duplicatePeople).toBe(4);

    const plan = await planLocalPartNetidMerges(db);
    const applied = await applyLocalPartNetidMerges(db, plan.merges, created);
    expect(applied.merged).toBe(2);
    expect(applied.referencesRepointed['researchers.accountId']).toBe(1);
    expect(applied.referencesRepointed['research_plans.accountId']).toBe(1);
    expect(
      applied.referencesRepointed['research_entities.studentVisibilityReviewedByAccountId'],
    ).toBe(1);
    expect(applied.researchPlansKeptOnArchivedAccount).toBe(1);

    const researcher = await db.collection('researchers').findOne({ _id: movedResearcher._id });
    expect(String(researcher?.accountId)).toBe(String(withReferences.netid._id));
    const entity = await db.collection('research_entities').findOne({ _id: reviewedEntityId });
    expect(String(entity?.studentVisibilityReviewedByAccountId)).toBe(
      String(withReferences.netid._id),
    );
    expect(
      await db.collection('research_plans').countDocuments({ accountId: withReferences.netid._id }),
    ).toBe(2);

    for (const pair of [mergeable, withReferences]) {
      const archived = await db.collection('accounts').findOne({ _id: pair.localPart._id });
      expect(archived).toMatchObject({
        archived: true,
        archivedReason: LOCAL_PART_TWIN_ARCHIVED_REASON,
      });
      expect(String(archived?.mergedIntoAccountId)).toBe(String(pair.netid._id));
    }
    expect(await db.collection('accounts').countDocuments({})).toBe(9);

    const after = await runPostMaterializationIntegrityGate();
    expect(after.counts.duplicatePeople).toBe(2);

    const rerun = await planLocalPartNetidMerges(db);
    expect(rerun.merges).toHaveLength(0);
    expect((await applyLocalPartNetidMerges(db, rerun.merges)).merged).toBe(0);
  });

  it('refuses a pair whose local part has netid-keyed history or a stored login', async () => {
    const { mergeable } = await seed();
    await db.collection('analytics_events').insertOne({ netid: mergeable.localPart.netid });
    await db
      .collection('accounts')
      .updateOne({ netid: 'beta.fixture' }, { $set: { lastLoginAt: created } });
    const plan = await planLocalPartNetidMerges(db);
    expect(plan.merges).toHaveLength(0);
    expect(plan.refusals['netid-keyed-references']).toBe(1);
    expect(plan.refusals['local-part-account-has-login']).toBe(1);
  });

  it('requires confirmation, a cap and the Development database to apply', () => {
    expect(parseMergeLocalPartNetidAccountsArgs([])).toMatchObject({ apply: false });
    const apply = parseMergeLocalPartNetidAccountsArgs(['--apply']);
    expect(() => assertMergeLocalPartNetidAccountsApplyAllowed(apply, 'Development')).toThrow(
      /confirm/,
    );
    const confirmed = parseMergeLocalPartNetidAccountsArgs([
      '--apply',
      '--confirm-merge-local-part-netid-twins',
    ]);
    expect(() => assertMergeLocalPartNetidAccountsApplyAllowed(confirmed, 'Development')).toThrow(
      /max-apply/,
    );
    const capped = parseMergeLocalPartNetidAccountsArgs([
      '--apply',
      '--confirm-merge-local-part-netid-twins',
      '--max-apply=10',
    ]);
    expect(() => assertMergeLocalPartNetidAccountsApplyAllowed(capped, 'Prod')).toThrow(
      /Development/,
    );
    expect(() =>
      assertMergeLocalPartNetidAccountsApplyAllowed(capped, 'Development'),
    ).not.toThrow();
    expect(() => assertMergeCountWithinCap(11, 10)).toThrow(/above --max-apply=10/);
    expect(() => parseMergeLocalPartNetidAccountsArgs(['--max-apply=0'])).toThrow();
  });
});
