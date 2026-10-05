import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { runPostMaterializationIntegrityGate } from '../../scrapers/integrityGate';
import {
  LONE_LOCAL_PART_ARCHIVED_REASON,
  LOCAL_PART_TWIN_ARCHIVED_REASON,
  applyLocalPartNetidMerges,
  applyLoneLocalPartArchives,
  planLocalPartNetidMerges,
  planLoneLocalPartArchives,
} from '../mergeLocalPartNetidAccountsCore';
import {
  LOCAL_PART_TWIN_RESEARCHER_DEDUPED_REASON,
  applyLocalPartTwinResearcherMerges,
  displayNamesClearlyAgree,
  planLocalPartTwinResearcherMerges,
  summarizeTwinResearcherMergeEdits,
} from '../mergeLocalPartTwinResearchersCore';
import { parseMergeLocalPartNetidAccountsArgs } from '../mergeLocalPartNetidAccounts';

const oid = () => new mongoose.Types.ObjectId();
const created = new Date('2026-08-27T21:00:00Z');
const SYNTHETIC_ORCID = '9999-9999-9999-9994';

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

function edgeRow(personId: mongoose.Types.ObjectId, entityId: mongoose.Types.ObjectId) {
  return {
    _id: oid(),
    schemaVersion: 1,
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    state: 'UNKNOWN',
    confidence: 0.8,
    reviewStatus: 'UNREVIEWED',
    archived: false,
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

  async function seedResearcherTwins() {
    const agreeing = {
      localPart: accountRow('alpha.fixture', 'alpha.fixture@yale.edu'),
      netid: accountRow('af1001', 'alpha.fixture@yale.edu'),
    };
    const disagreeing = {
      localPart: accountRow('beta.fixture', 'beta.fixture@yale.edu'),
      netid: accountRow('bf1002', 'beta.fixture@yale.edu'),
    };
    await db
      .collection('accounts')
      .insertMany([agreeing.localPart, agreeing.netid, disagreeing.localPart, disagreeing.netid]);
    const loser = researcherRow(agreeing.localPart._id, 'Avery Q. Fixture', {
      identifiers: { netid: 'alpha.fixture', orcid: SYNTHETIC_ORCID },
      profileLinks: [
        {
          kind: 'ORCID',
          purpose: 'SCHOLARLY',
          url: `https://orcid.org/${SYNTHETIC_ORCID}`,
          verifiedAt: created,
          healthStatus: 'HEALTHY',
        },
      ],
      profile: { title: 'Professor of Synthetic Studies' },
    });
    const survivor = researcherRow(agreeing.netid._id, 'Avery Fixture', {
      identifiers: { netid: 'af1001' },
    });
    const disagreeingLoser = researcherRow(disagreeing.localPart._id, 'Blake Fixture');
    const disagreeingSurvivor = researcherRow(disagreeing.netid._id, 'Casey Fixture');
    await db
      .collection('researchers')
      .insertMany([loser, survivor, disagreeingLoser, disagreeingSurvivor]);
    const sharedRow = oid();
    const loserOnlyRow = oid();
    const survivorEdge = edgeRow(survivor._id, sharedRow);
    const redundantEdge = edgeRow(loser._id, sharedRow);
    const movedEdge = edgeRow(loser._id, loserOnlyRow);
    await db.collection('role_assignments').insertMany([survivorEdge, redundantEdge, movedEdge]);
    return { agreeing, disagreeing, loser, survivor, redundantEdge, movedEdge, survivorEdge };
  }

  it('agrees on names only for the same surname and the same given name or its initial', () => {
    expect(displayNamesClearlyAgree('Avery Q. Fixture', 'Avery Fixture')).toBe(true);
    expect(displayNamesClearlyAgree('A. Fixture', 'Avery Fixture')).toBe(true);
    expect(displayNamesClearlyAgree('Avéry Fixture', 'Avery Fixture')).toBe(true);
    expect(displayNamesClearlyAgree('Blake Fixture', 'Casey Fixture')).toBe(false);
    expect(displayNamesClearlyAgree('Avery Fixture', 'Avery Fixture Sample')).toBe(false);
    expect(displayNamesClearlyAgree('Q. Avery Fixture', 'Avery Q. Fixture')).toBe(false);
    expect(displayNamesClearlyAgree('Fixture', 'Avery Fixture')).toBe(false);
  });

  it('merges the agreeing researcher into the real-netid record and holds the other pair', async () => {
    const seeded = await seedResearcherTwins();
    const before = await runPostMaterializationIntegrityGate();
    expect(before.counts.duplicatePeople).toBe(2);

    const plan = await planLocalPartTwinResearcherMerges(db);
    expect(plan.pairsWithBothResearchers).toBe(2);
    expect(plan.merges).toHaveLength(1);
    expect(plan.held['researcher-names-disagree']).toBe(1);
    expect(await summarizeTwinResearcherMergeEdits(db, plan.merges)).toMatchObject({
      edgesToRepoint: 1,
      edgesToArchiveRedundant: 1,
      entitiesToRegate: 2,
      identifiersToFill: { orcid: 1 },
      loserLocalPartNetidsToClear: 1,
    });

    const applied = await applyLocalPartTwinResearcherMerges(db, plan.merges, created);
    expect(applied).toMatchObject({
      researchersMerged: 1,
      edgesRepointed: 1,
      edgesArchivedRedundant: 1,
      skippedStale: 0,
    });
    expect(applied.touchedEntityIds).toHaveLength(2);

    const loser = await db.collection('researchers').findOne({ _id: seeded.loser._id });
    expect(loser).toMatchObject({
      archived: true,
      dedupedReason: LOCAL_PART_TWIN_RESEARCHER_DEDUPED_REASON,
    });
    expect(String(loser?.dedupedIntoResearcherId)).toBe(String(seeded.survivor._id));
    expect(loser?.accountId).toBeUndefined();
    expect(loser?.identifiers?.netid).toBeUndefined();
    expect(loser?.identifiers?.orcid).toBeUndefined();
    expect(loser?.profileLinks).toEqual([]);

    const survivor = await db.collection('researchers').findOne({ _id: seeded.survivor._id });
    expect(survivor?.identifiers).toEqual({ netid: 'af1001', orcid: SYNTHETIC_ORCID });
    expect(survivor?.profile?.title).toBe('Professor of Synthetic Studies');
    expect(survivor?.profileLinks.map((link: { kind: string }) => link.kind)).toEqual(['ORCID']);

    const moved = await db.collection('role_assignments').findOne({ _id: seeded.movedEdge._id });
    expect(String(moved?.personId)).toBe(String(seeded.survivor._id));
    expect(moved?.archived).toBe(false);
    const redundant = await db
      .collection('role_assignments')
      .findOne({ _id: seeded.redundantEdge._id });
    expect(redundant).toMatchObject({ archived: true });
    expect(String(redundant?.personId)).toBe(String(seeded.loser._id));
    expect(await db.collection('researchers').countDocuments({})).toBe(4);

    const rerun = await planLocalPartTwinResearcherMerges(db);
    expect(rerun.merges).toHaveLength(0);
    expect(rerun.held['researcher-names-disagree']).toBe(1);
  });

  it('lets the account merge archive the local-part account once its researcher is merged', async () => {
    const seeded = await seedResearcherTwins();
    const blocked = await planLocalPartNetidMerges(db);
    expect(blocked.merges).toHaveLength(0);
    expect(blocked.refusals['both-accounts-link-a-researcher']).toBe(2);

    const researcherPlan = await planLocalPartTwinResearcherMerges(db);
    await applyLocalPartTwinResearcherMerges(db, researcherPlan.merges, created);

    const accountPlan = await planLocalPartNetidMerges(db);
    expect(accountPlan.merges.map((merge) => String(merge.localPartAccountId))).toEqual([
      String(seeded.agreeing.localPart._id),
    ]);
    expect(accountPlan.refusals['both-accounts-link-a-researcher']).toBe(1);
    expect(accountPlan.refusals['researcher-identifier-holds-local-part']).toBe(0);
    const merged = await applyLocalPartNetidMerges(db, accountPlan.merges, created);
    expect(merged.merged).toBe(1);
    expect(
      await db.collection('accounts').findOne({ _id: seeded.agreeing.localPart._id }),
    ).toMatchObject({ archived: true, archivedReason: LOCAL_PART_TWIN_ARCHIVED_REASON });

    const after = await runPostMaterializationIntegrityGate();
    expect(after.counts.duplicatePeople).toBe(1);
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
    await db
      .collection('research_plans')
      .insertOne({
        _id: oid(),
        accountId: planner._id,
        target: { kind: 'RESEARCH_ENTITY', id: oid() },
      });
    await db
      .collection('research_entities')
      .insertOne({
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

  it('defaults to the account-twin scope and parses the residue scopes', () => {
    expect(parseMergeLocalPartNetidAccountsArgs([]).scope).toBe('account-twins');
    expect(parseMergeLocalPartNetidAccountsArgs(['--scope=researcher-twins']).scope).toBe(
      'researcher-twins',
    );
    expect(parseMergeLocalPartNetidAccountsArgs(['--scope', 'lone-accounts']).scope).toBe(
      'lone-accounts',
    );
    expect(() => parseMergeLocalPartNetidAccountsArgs(['--scope=everything'])).toThrow(/--scope/);
  });
});
