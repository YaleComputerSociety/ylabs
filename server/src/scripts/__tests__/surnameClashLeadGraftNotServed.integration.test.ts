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

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  const seedLead = async (input: {
    entityId: mongoose.Types.ObjectId;
    displayName: string;
    netid: string;
    confidence: number;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: input.displayName,
      identifiers: { netid: input.netid },
      profile: { title: 'Associate Professor' },
      primaryDepartment: 'Pediatrics',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: input.entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: input.confidence,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-faculty', url: 'https://medicine.yale.edu/profile/quimby/' },
    });
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

    const entityId = new mongoose.Types.ObjectId();
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
    await seedLead({ entityId, displayName: 'Robin Quimby', netid: 'rq111', confidence: 0.7 });
    await seedLead({ entityId, displayName: 'Pradeep Quimby', netid: 'pq222', confidence: 0.9 });
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
});
