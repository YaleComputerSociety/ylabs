import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const survivorId = new mongoose.Types.ObjectId();
const shellId = new mongoose.Types.ObjectId();
const foldedShellId = new mongoose.Types.ObjectId();
const rowId = new mongoose.Types.ObjectId();
const healRowId = new mongoose.Types.ObjectId();
const shellCurrentEdgeId = new mongoose.Types.ObjectId();
const survivorEndedEdgeId = new mongoose.Types.ObjectId();
const foldedArchivedEdgeId = new mongoose.Types.ObjectId();
const survivorEndedHealEdgeId = new mongoose.Types.ObjectId();

const foldedAt = new Date('2026-11-12T22:00:00Z');
const endedBeforeFold = new Date('2026-11-01T00:00:00Z');

describe('the researcher fold keeps current memberships (#5990, DB-backed)', () => {
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
    await db.collection('role_assignments').deleteMany({});
    await db.collection('research_entities').deleteMany({});
    await db.collection('admin_audit_events').deleteMany({});

    await db.collection('research_entities').insertMany([
      { _id: rowId, slug: 'synthetic-center-row', name: 'Synthetic Center', archived: false },
      { _id: healRowId, slug: 'synthetic-lab-row', name: 'Synthetic Lab', archived: false },
    ]);
    await db.collection('researchers').insertMany([
      {
        _id: survivorId,
        displayName: 'Avery Synth',
        archived: false,
        identifiers: { email: 'directory.fixture1@example.test' },
      },
      { _id: shellId, displayName: 'Avery Synth', archived: false },
      {
        _id: foldedShellId,
        displayName: 'Avery Synth',
        archived: true,
        dedupedIntoResearcherId: survivorId,
        dedupedAt: foldedAt,
      },
    ]);
    await db.collection('role_assignments').insertMany([
      {
        _id: survivorEndedEdgeId,
        personId: survivorId,
        target: { kind: 'RESEARCH_ENTITY', id: rowId },
        role: 'CORE_FACULTY',
        state: 'HISTORICAL',
        endedAt: endedBeforeFold,
        reviewStatus: 'UNREVIEWED',
        archived: false,
      },
      {
        _id: shellCurrentEdgeId,
        personId: shellId,
        target: { kind: 'RESEARCH_ENTITY', id: rowId },
        role: 'CORE_FACULTY',
        state: 'UNKNOWN',
        reviewStatus: 'UNREVIEWED',
        archived: false,
      },
      {
        _id: survivorEndedHealEdgeId,
        personId: survivorId,
        target: { kind: 'RESEARCH_ENTITY', id: healRowId },
        role: 'STAFF',
        state: 'HISTORICAL',
        endedAt: endedBeforeFold,
        reviewStatus: 'UNREVIEWED',
        archived: false,
      },
      {
        _id: foldedArchivedEdgeId,
        personId: foldedShellId,
        target: { kind: 'RESEARCH_ENTITY', id: healRowId },
        role: 'STAFF',
        state: 'UNKNOWN',
        reviewStatus: 'UNREVIEWED',
        archived: true,
      },
    ]);
  });

  it('dry run plans the repoint and the heal and writes nothing', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: false });
    expect(result.shellsMerged).toBe(1);
    expect(result.roleAssignmentsRepointed).toBe(1);
    expect(result.roleAssignmentsArchivedRedundant).toBe(0);
    expect(result.heals.map((heal) => heal.edgeId)).toEqual([String(foldedArchivedEdgeId)]);
    const healed = await mongoose.connection
      .db!.collection('role_assignments')
      .findOne({ _id: foldedArchivedEdgeId });
    expect(healed!.archived).toBe(true);
    expect(String(healed!.personId)).toBe(String(foldedShellId));
  });

  it('moves a current shell edge onto the survivor beside its ended edge, and heals the earlier fold', async () => {
    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.roleAssignmentsArchivedRedundant).toBe(0);
    expect(result.roleAssignmentsHealed).toBe(1);

    const db = mongoose.connection.db!;
    const moved = await db.collection('role_assignments').findOne({ _id: shellCurrentEdgeId });
    expect(String(moved!.personId)).toBe(String(survivorId));
    expect(moved!.archived).toBe(false);
    expect(moved!.state).toBe('UNKNOWN');
    const history = await db.collection('role_assignments').findOne({ _id: survivorEndedEdgeId });
    expect(history!.state).toBe('HISTORICAL');

    const healed = await db.collection('role_assignments').findOne({ _id: foldedArchivedEdgeId });
    expect(String(healed!.personId)).toBe(String(survivorId));
    expect(healed!.archived).toBe(false);
    expect(healed!.reviewStatus).toBe('UNREVIEWED');
  });

  it('is a no-op on the second run', async () => {
    await dedupeAccountlessResearcherShells({ apply: true });
    const second = await dedupeAccountlessResearcherShells({ apply: true });
    expect(second.shellsMerged).toBe(0);
    expect(second.roleAssignmentsRepointed).toBe(0);
    expect(second.roleAssignmentsArchivedRedundant).toBe(0);
    expect(second.roleAssignmentsHealed).toBe(0);
    const current = await mongoose.connection
      .db!.collection('role_assignments')
      .countDocuments({ personId: survivorId, archived: false, state: { $ne: 'HISTORICAL' } });
    expect(current).toBe(2);
  });

  it('leaves an archived edge an audit record names', async () => {
    await mongoose.connection.db!.collection('admin_audit_events').insertOne({
      actorNetid: 'operator',
      action: 'role-assignment.detach',
      targetType: 'RoleAssignment',
      targetId: String(foldedArchivedEdgeId),
      timestamp: new Date(),
    });
    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.roleAssignmentsHealed).toBe(0);
    const edge = await mongoose.connection
      .db!.collection('role_assignments')
      .findOne({ _id: foldedArchivedEdgeId });
    expect(edge!.archived).toBe(true);
  });

  it('still archives a current shell edge beside a current survivor edge', async () => {
    await mongoose.connection
      .db!.collection('role_assignments')
      .updateOne(
        { _id: survivorEndedEdgeId },
        { $set: { state: 'CURRENT' }, $unset: { endedAt: '' } },
      );
    const result = await dedupeAccountlessResearcherShells({ apply: true });
    expect(result.roleAssignmentsArchivedRedundant).toBe(1);
    const shellEdge = await mongoose.connection
      .db!.collection('role_assignments')
      .findOne({ _id: shellCurrentEdgeId });
    expect(shellEdge!.archived).toBe(true);
  });
});
