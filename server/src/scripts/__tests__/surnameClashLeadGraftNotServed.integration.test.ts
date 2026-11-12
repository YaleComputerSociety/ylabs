import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail, PUBLIC_LEAD_ROLES } from '../../services/researchGroupService';
import { retireSurnameClashLeadGrafts } from '../retireSurnameClashLeadGrafts';

const SLUG = 'ysm-faculty-robin-quimby';
const SHORT_DESCRIPTION =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const FULL_DESCRIPTION =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

const servedLeadNames = async (): Promise<string[]> => {
  const detail = await getResearchGroupDetail(SLUG);
  return (detail?.members || [])
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => String(member.user?.displayName || ''))
    .filter(Boolean);
};

describe('a same-surname stranger stops being served as a co-equal PI (#2768)', () => {
  let replSet: MongoMemoryReplSet;
  let entityId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const seedLead = async (input: {
    entityId: mongoose.Types.ObjectId;
    displayName: string;
    confidence: number;
    netid?: string;
    profile?: Record<string, string>;
    rosterVerified?: boolean;
    archived?: boolean;
    dedupedIntoResearcherId?: mongoose.Types.ObjectId;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      schemaVersion: 1,
      displayName: input.displayName,
      ...(input.netid ? { identifiers: { netid: input.netid } } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      status: 'ACTIVE',
      profileLinks: [],
      archived: input.archived === true,
      ...(input.dedupedIntoResearcherId
        ? { dedupedIntoResearcherId: input.dedupedIntoResearcherId }
        : {}),
    });
    await db.collection('role_assignments').insertOne({
      personId,
      schemaVersion: 1,
      target: { kind: 'RESEARCH_ENTITY', id: input.entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: input.confidence,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      rosterProvenance: {
        sourceName: 'ysm-faculty',
        sourceUrl: 'https://medicine.yale.edu/profile/quimby/',
        observedAt: new Date(),
        ...(input.rosterVerified ? { evidenceStatus: 'verified' } : {}),
      },
    });
    return personId;
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }

    entityId = new mongoose.Types.ObjectId();
    const sourceUrl = 'https://medicine.yale.edu/profile/quimby/';
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Quimby Neonatal Outcomes Lab',
      displayName: 'Quimby Neonatal Outcomes Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl },
        displayName: { sourceName: 'ysm-faculty', sourceUrl },
      },
    });

    // The stranger carries the higher confidence on purpose: confidence is
    // anti-correlated with correctness on this class, so a lane that ranked by it
    // would keep this one and detach the person the entity is named after.
    await seedLead({
      entityId,
      displayName: 'Robin Quimby',
      netid: 'rq111',
      profile: { title: 'Associate Professor' },
      confidence: 0.7,
    });
    await seedLead({
      entityId,
      displayName: 'Pradeep Quimby',
      netid: 'pq222',
      profile: { title: 'Associate Professor' },
      confidence: 0.9,
    });
  });

  it('serves both same-surname leads before the operation runs', async () => {
    expect((await servedLeadNames()).sort()).toEqual(['Pradeep Quimby', 'Robin Quimby']);
  }, 30000);

  it('leaves only the lead the entity is named after once the operation has run', async () => {
    const report = await retireSurnameClashLeadGrafts({ dryRun: false });
    expect(report).toMatchObject({ plannedDetachments: 1, detached: 1, regatedEntities: 1 });
    expect(await servedLeadNames()).toEqual(['Robin Quimby']);
  }, 30000);

  it('writes an adjudication a later pass can read rather than deleting the row', async () => {
    await retireSurnameClashLeadGrafts({ dryRun: false });
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const detached = await db.collection('role_assignments').find({ archived: true }).toArray();
    expect(detached).toHaveLength(1);
    expect(detached[0].reviewStatus).toBe('DISPUTED');
    expect(String(detached[0].reviewNotes)).toContain('#2768');
  }, 30000);

  it('changes nothing in a dry run', async () => {
    const report = await retireSurnameClashLeadGrafts({ dryRun: true });
    expect(report).toMatchObject({ plannedDetachments: 1, detached: 0, regatedEntities: 0 });
    expect((await servedLeadNames()).sort()).toEqual(['Pradeep Quimby', 'Robin Quimby']);
  }, 30000);

  it('keeps a roster-listed co-lead attached and holds the ambiguous row for review', async () => {
    await seedLead({
      entityId,
      displayName: 'David Quimby',
      netid: 'dq333',
      profile: { title: 'Associate Professor' },
      confidence: 0.6,
      rosterVerified: true,
    });

    const report = await retireSurnameClashLeadGrafts({ dryRun: false });
    expect(report).toMatchObject({ plannedDetachments: 1, detached: 1 });
    expect(report.refusedByReason).toMatchObject({
      'candidate-corroborated-by-the-entity-roster': 1,
    });

    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const attached = await db
      .collection('role_assignments')
      .aggregate([
        { $match: { archived: { $ne: true } } },
        {
          $lookup: {
            from: 'researchers',
            localField: 'personId',
            foreignField: '_id',
            as: 'person',
          },
        },
      ])
      .toArray();
    expect(attached.map((row) => String(row.person?.[0]?.displayName)).sort()).toEqual([
      'David Quimby',
      'Robin Quimby',
    ]);

    const entity = await db.collection('research_entities').findOne({ slug: SLUG });
    expect(entity?.studentVisibilityTier).toBe('operator_review');
    expect(entity?.studentVisibilityReasons).toContain('profile_identity_risk');
    expect(await servedLeadNames()).toEqual([]);
  }, 30000);

  it('refuses to let a bare-name survivor evict a netid-backed record', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('role_assignments').deleteMany({});
    await db.collection('researchers').deleteMany({});
    await seedLead({ entityId, displayName: 'Robin Quimby', confidence: 0.7 });
    await seedLead({
      entityId,
      displayName: 'Pradeep Quimby',
      netid: 'pq222',
      confidence: 0.9,
    });

    const report = await retireSurnameClashLeadGrafts({ dryRun: false });
    expect(report).toMatchObject({ plannedDetachments: 0, detached: 0 });
    expect(report.refusedByReason).toMatchObject({ 'named-lead-is-an-unanchored-shell': 1 });
    expect((await servedLeadNames()).sort()).toEqual(['Pradeep Quimby', 'Robin Quimby']);
  }, 30000);

  it('no longer reads a department alone as identity that shields a stranger (#5941)', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('role_assignments').deleteMany({});
    await db.collection('researchers').deleteMany({});
    await seedLead({ entityId, displayName: 'Robin Quimby', confidence: 0.7 });
    await seedLead({
      entityId,
      displayName: 'Pradeep Quimby',
      profile: { primaryDepartment: 'Pediatrics' },
      confidence: 0.9,
    });

    const report = await retireSurnameClashLeadGrafts({ dryRun: true });
    expect(report).toMatchObject({ plannedDetachments: 1, detached: 0 });
    expect(report.refusedByReason).toMatchObject({ 'named-lead-is-an-unanchored-shell': 0 });
  }, 30000);

  it('never detaches a live record beside its own name-only duplicate, on any run (#5941)', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('role_assignments').deleteMany({});
    await db.collection('researchers').deleteMany({});
    await db
      .collection('research_entities')
      .updateOne({ _id: entityId }, { $set: { slug: 'ysm-quimby' } });
    const livePersonId = await seedLead({
      entityId,
      displayName: 'Robin Quimby',
      netid: 'rq111',
      profile: { title: 'Associate Professor', primaryDepartment: 'Pediatrics' },
      confidence: 0.7,
    });
    await seedLead({
      entityId,
      displayName: 'Robin Quimby',
      profile: { title: 'Associate Professor' },
      confidence: 0.9,
    });
    await seedLead({
      entityId,
      displayName: 'Robyn Quimby',
      profile: { primaryDepartment: 'Pediatrics' },
      archived: true,
      dedupedIntoResearcherId: livePersonId,
      confidence: 0.8,
    });
    const before = await db.collection('role_assignments').find({}).sort({ _id: 1 }).toArray();

    const first = await retireSurnameClashLeadGrafts({ dryRun: false });
    const second = await retireSurnameClashLeadGrafts({ dryRun: false });

    expect(first).toMatchObject({ plannedDetachments: 0, detached: 0, regatedEntities: 0 });
    expect(first.refusedByReason).toMatchObject({ 'one-person-recorded-twice': 1 });
    expect(second).toEqual(first);
    expect(await db.collection('role_assignments').find({}).sort({ _id: 1 }).toArray()).toEqual(
      before,
    );
  }, 30000);

  it('still detaches a different same-surname person with a different netid (#5941)', async () => {
    const report = await retireSurnameClashLeadGrafts({ dryRun: true });
    expect(report).toMatchObject({ plannedDetachments: 1 });
    expect(report.refusedByReason).toMatchObject({ 'one-person-recorded-twice': 0 });
  }, 30000);

  it('lists a past detachment whose person an archived duplicate of the entity resolves to (#5941)', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('role_assignments').deleteMany({});
    await db.collection('researchers').deleteMany({});
    await db
      .collection('research_entities')
      .updateOne({ _id: entityId }, { $set: { slug: 'ysm-quimby' } });
    const detachedPersonId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: detachedPersonId,
      schemaVersion: 1,
      displayName: 'Robin Quimby',
      identifiers: { netid: 'rq111' },
      status: 'ACTIVE',
      profileLinks: [],
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId: detachedPersonId,
      schemaVersion: 1,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      reviewStatus: 'DISPUTED',
      reviewNotes:
        'Detached as a same-surname lead on an entity whose own identity names a different person (#2768).',
      archived: true,
    });
    const duplicatePersonId = await seedLead({
      entityId,
      displayName: 'Robin Quimby',
      archived: true,
      dedupedIntoResearcherId: detachedPersonId,
      confidence: 0.8,
    });
    await db
      .collection('role_assignments')
      .updateOne({ personId: duplicatePersonId }, { $set: { archived: true } });

    const report = await retireSurnameClashLeadGrafts({ dryRun: true });
    expect(report).toMatchObject({
      pastDetachmentsScanned: 1,
      pastDetachmentsOfTheNamedPerson: 1,
      pastDetachmentEntitySlugsOfTheNamedPerson: ['ysm-quimby'],
    });
  }, 30000);

  it('lists a past detachment of the person the entity names, read-only, on every run (#5853)', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const pastDetachedEdge = async (displayName: string) => {
      const personId = new mongoose.Types.ObjectId();
      await db.collection('researchers').insertOne({
        _id: personId,
        schemaVersion: 1,
        displayName,
        status: 'ACTIVE',
        profileLinks: [],
        archived: false,
      });
      await db.collection('role_assignments').insertOne({
        personId,
        schemaVersion: 1,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'PI',
        state: 'CURRENT',
        reviewStatus: 'DISPUTED',
        reviewNotes:
          'Detached as a same-surname lead on an entity whose own identity names a different person (#2768).',
        archived: true,
      });
    };
    await pastDetachedEdge('Robyn Quimby');
    await pastDetachedEdge('Pradeep Quimby');
    const before = await db.collection('role_assignments').find({}).sort({ _id: 1 }).toArray();

    const first = await retireSurnameClashLeadGrafts({ dryRun: true });
    const second = await retireSurnameClashLeadGrafts({ dryRun: true });

    expect(first).toMatchObject({
      pastDetachmentsScanned: 2,
      pastDetachmentsOfTheNamedPerson: 1,
      pastDetachmentEntitySlugsOfTheNamedPerson: [SLUG],
    });
    expect(second).toEqual(first);
    expect(await db.collection('role_assignments').find({}).sort({ _id: 1 }).toArray()).toEqual(
      before,
    );
  }, 30000);
});
