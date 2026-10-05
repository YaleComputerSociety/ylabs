import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
  readIndexedFieldByDocumentId: vi.fn(async () => new Map()),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
  readIndexedFieldByDocumentId: meiliMocks.readIndexedFieldByDocumentId,
}));

import { materializeCanonicalMembership } from '../../scrapers/canonicalMembershipMaterializer';
import { runPostMaterializationIntegrityGate } from '../../scrapers/integrityGate';
import {
  applyArchivedEntityArtifactRepairPlan,
  assertDisputedDetachmentApplyTarget,
  assertDisputedDetachmentScope,
  loadArchivedEntityArtifactPlan,
  parseRepairArchivedEntityArtifactsArgs,
} from '../repairArchivedEntityArtifacts';

const OPERATOR_REASON = 'operator:lead-and-cited-profile-are-different-people';
const SOURCE_URL = 'https://example.invalid/synthetic-profile/';

const db = () => {
  const connection = mongoose.connection.db;
  if (!connection) throw new Error('no db');
  return connection;
};

describe('research-entity:repair-archived-artifacts --detach-disputed (#4917)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await db().dropDatabase();
  });

  const seedArchivedRowWithLiveLead = async (archivedReason: string) => {
    const entityId = new mongoose.Types.ObjectId();
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const netid = `zz${String(entityId).slice(-4)}`;
    const displayName = 'Synthetic Lead';
    await db()
      .collection('research_entities')
      .insertOne({
        _id: entityId,
        slug: `synthetic-row-${String(entityId).slice(-4)}`,
        name: 'Synthetic Row',
        archived: true,
        archivedReason,
        archivedAt: new Date('2026-10-04T00:00:00Z'),
      });
    await db()
      .collection('accounts')
      .insertOne({
        _id: accountId,
        netid,
        email: `${netid}@example.invalid`,
        status: 'UNKNOWN',
        archived: false,
      });
    await db().collection('researchers').insertOne({
      _id: personId,
      schemaVersion: 1,
      displayName,
      accountId,
      identifiers: { netid },
      status: 'ACTIVE',
      profileLinks: [],
      archived: false,
    });
    const edge = await db()
      .collection('role_assignments')
      .insertOne({
        personId,
        schemaVersion: 1,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'PI',
        state: 'UNKNOWN',
        confidence: 0.8,
        reviewStatus: 'UNREVIEWED',
        archived: false,
      });
    return { entityId, edgeId: edge.insertedId, netid, displayName };
  };

  const scope = { archivedReasons: new Set([OPERATOR_REASON]) };

  it('detaches the live lead as DISPUTED with the operator reason, never as HISTORICAL', async () => {
    const seeded = await seedArchivedRowWithLiveLead(OPERATOR_REASON);
    expect(
      (await runPostMaterializationIntegrityGate({ includeSamples: false })).counts
        .currentMembersOnArchivedEntities,
    ).toBe(1);

    const { plan } = await loadArchivedEntityArtifactPlan(
      100,
      scope,
      ['RoleAssignment'],
      'detach-disputed',
    );
    expect(plan.detachDisputed.map((item) => item.id)).toEqual([String(seeded.edgeId)]);
    expect(plan.archiveWithoutCanonical).toEqual([]);

    const applied = await applyArchivedEntityArtifactRepairPlan(plan);
    expect(applied.detachedDisputed).toBe(1);
    expect(applied.archivedWithoutCanonical).toBe(0);

    const edge = await db().collection('role_assignments').findOne({ _id: seeded.edgeId });
    expect(edge).toMatchObject({ archived: true, reviewStatus: 'DISPUTED', state: 'UNKNOWN' });
    expect(edge?.endedAt).toBeUndefined();
    expect(String(edge?.reviewNotes)).toContain(OPERATOR_REASON);
    expect(String(edge?.reviewNotes)).toContain('#4917');

    expect(
      (await runPostMaterializationIntegrityGate({ includeSamples: false })).counts
        .currentMembersOnArchivedEntities,
    ).toBe(0);
  }, 30000);

  it('keeps the detached lead detached when the next materialize re-observes it', async () => {
    const seeded = await seedArchivedRowWithLiveLead(OPERATOR_REASON);
    const { plan } = await loadArchivedEntityArtifactPlan(
      100,
      scope,
      ['RoleAssignment'],
      'detach-disputed',
    );
    await applyArchivedEntityArtifactRepairPlan(plan);

    await materializeCanonicalMembership(
      seeded.entityId.toHexString(),
      {
        legacyRole: 'pi',
        displayName: seeded.displayName,
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.9,
        rosterProvenance: {
          sourceName: 'synthetic-roster',
          sourceUrl: SOURCE_URL,
          observedAt: new Date(),
        },
      },
      {
        netid: seeded.netid,
        email: `${seeded.netid}@example.invalid`,
        displayName: seeded.displayName,
      },
    );

    const edges = await db()
      .collection('role_assignments')
      .find({ 'target.id': seeded.entityId, role: 'PI' })
      .toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ archived: true, reviewStatus: 'DISPUTED' });
    expect(
      (await runPostMaterializationIntegrityGate({ includeSamples: false })).counts
        .currentMembersOnArchivedEntities,
    ).toBe(0);

    const rerun = await loadArchivedEntityArtifactPlan(
      100,
      scope,
      ['RoleAssignment'],
      'detach-disputed',
    );
    expect(rerun.plan.detachDisputed).toEqual([]);
  }, 30000);

  it('refuses to detach an edge on a row a lane archived', async () => {
    const seeded = await seedArchivedRowWithLiveLead(
      'research-entity:retire-staff-minted-entities',
    );
    const { plan } = await loadArchivedEntityArtifactPlan(
      100,
      {},
      ['RoleAssignment'],
      'detach-disputed',
    );
    expect(plan.detachDisputed).toEqual([]);
    expect(plan.skipped.map((item) => [item.id, item.reason])).toEqual([
      [String(seeded.edgeId), 'not-an-operator-archive'],
    ]);
  }, 30000);

  it('requires one operator archive reason, role edges only, and Development to apply', () => {
    const parse = (args: string[]) => parseRepairArchivedEntityArtifactsArgs(args);
    expect(parse([]).roleEdgeDisposition).toBe('settle');
    expect(() => assertDisputedDetachmentScope(parse(['--detach-disputed']))).toThrow(
      /operator:<reason>/,
    );
    expect(() =>
      assertDisputedDetachmentScope(
        parse([
          '--detach-disputed',
          '--archived-reason=research-entity:retire-staff-minted-entities',
          '--artifact-type=role-assignment',
        ]),
      ),
    ).toThrow(/operator:<reason>/);
    expect(() =>
      assertDisputedDetachmentScope(
        parse(['--detach-disputed', `--archived-reason=${OPERATOR_REASON}`]),
      ),
    ).toThrow(/role-assignment/);
    const scoped = parse([
      '--detach-disputed',
      `--archived-reason=${OPERATOR_REASON}`,
      '--artifact-type=role-assignment',
      '--apply',
    ]);
    expect(() => assertDisputedDetachmentScope(scoped)).not.toThrow();
    expect(() => assertDisputedDetachmentApplyTarget(scoped, 'Prod')).toThrow(/Development/);
    expect(() => assertDisputedDetachmentApplyTarget(scoped, 'Development')).not.toThrow();
  });
});
