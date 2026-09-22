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

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { reclaimInferredPiLeads } from '../inferredPiLeadReclaim';

const SLUG = 'synthetic-alias-keyed-neonatal-lab';
const LEAD_NAME = 'Avery Parker';
const LEAD_NETID = 'aparker';
const ALIAS_PI_KEY = 'netid:avery.parker';
const SOURCE_URL = 'https://example.edu/profile/synthetic-alias-lead/';
const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

type PersistedVisibility = {
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = () =>
  ResearchEntity.findOne({
    slug: SLUG,
  }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('an alias-keyed PI attribution stops holding an entity from students (#2763)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'accounts',
      'observations',
      'visibility_release_queue_items',
      'signals',
    ]) {
      await db.collection(name).deleteMany({});
    }

    const account = await Account.create({
      netid: LEAD_NETID,
      email: `${LEAD_NETID}@yale.edu`,
      status: 'ACTIVE',
      archived: false,
    });
    await Researcher.create({
      schemaVersion: 1,
      displayName: LEAD_NAME,
      firstName: 'Avery',
      lastName: 'Parker',
      accountId: account._id,
      status: 'ACTIVE',
      archived: false,
    });

    await ResearchEntity.create({
      slug: SLUG,
      name: 'Parker Neonatal Outcomes Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology', 'Health services research'],
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: ['missing_lead'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: SOURCE_URL,
      sourceUrls: [SOURCE_URL],
      fieldProvenance: {
        shortDescription: { sourceName: 'official-profile-pi-backfill', sourceUrl: SOURCE_URL },
        fullDescription: { sourceName: 'official-profile-pi-backfill', sourceUrl: SOURCE_URL },
      },
    });

    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'inferredPiUserKey',
      value: ALIAS_PI_KEY,
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: SOURCE_URL,
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.88,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  });

  it('holds the entity on missing_lead until the PI key resolves, then serves it with the lead named', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const held = await persisted();
    expect(held.studentVisibilityTier).toBe('operator_review');
    expect(held.studentVisibilityReasons).toContain('missing_lead');
    expect(await getResearchGroupDetail(SLUG)).toBeNull();

    const reclaim = await reclaimInferredPiLeads({ apply: true, scope: 'all' });
    expect(reclaim.tally['materialized-lead']).toBe(1);
    expect(reclaim.tally['still-unresolved']).toBe(0);

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const released = await persisted();
    expect(released.studentVisibilityTier).toBe('student_ready');
    expect(released.studentVisibilityReasons).not.toContain('missing_lead');

    const detail = await getResearchGroupDetail(SLUG);
    expect(detail).not.toBeNull();
    const lead = detail?.members.find((member) => member.role === 'pi');
    expect(lead?.user?.displayName).toBe(LEAD_NAME);
  }, 40000);
});
