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
import { RoleAssignment } from '../../models/roleAssignment';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { reclaimInferredPiLeads } from '../inferredPiLeadReclaim';

const SLUG = 'synthetic-gate-rejected-lead-neonatal-lab';
const LEAD_NAME = 'Avery Parker';
const LEAD_NETID = 'aparker';
const ALIAS_PI_KEY = 'netid:avery.parker';
const SOURCE_URL = 'https://example.edu/profile/synthetic-gate-rejected-lead/';
const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

type PersistedVisibility = {
  _id?: unknown;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = () =>
  ResearchEntity.findOne({
    slug: SLUG,
  }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('the PI-lead lane revisits a row whose only lead edge the gate rejects (#2931)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

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

  const seedRejectedLeadEdge = async (input: {
    archived: boolean;
    title?: string;
    personArchived?: boolean;
  }) => {
    const entity = await persisted();
    const person = await Researcher.create({
      schemaVersion: 1,
      displayName: 'Robin Vance',
      ...(input.title ? { profile: { title: input.title } } : {}),
      status: 'ACTIVE',
      archived: Boolean(input.personArchived),
    });
    await RoleAssignment.create({
      schemaVersion: 1,
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.7,
      reviewStatus: 'UNREVIEWED',
      archived: input.archived,
    });
  };

  const resolveAndRegate = async () => {
    const reclaim = await reclaimInferredPiLeads({ apply: true, scope: 'all' });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    return reclaim;
  };

  it('revisits a row whose every lead edge is archived, and the resolved lead reaches students', async () => {
    await seedRejectedLeadEdge({ archived: true });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const held = await persisted();
    expect(held.studentVisibilityTier).toBe('operator_review');
    expect(held.studentVisibilityReasons).toContain('missing_lead');
    expect(await getResearchGroupDetail(SLUG)).toBeNull();

    const reclaim = await resolveAndRegate();
    expect(reclaim.lagging).toBe(1);
    expect(reclaim.tally['materialized-lead']).toBe(1);

    const released = await persisted();
    expect(released.studentVisibilityTier).toBe('student_ready');
    expect(released.studentVisibilityReasons).not.toContain('missing_lead');
    const detail = await getResearchGroupDetail(SLUG);
    expect(detail?.members.find((member) => member.role === 'pi')?.user?.displayName).toBe(
      LEAD_NAME,
    );
  }, 120000);

  it('revisits a row whose only live lead edge holds a trainee title', async () => {
    await seedRejectedLeadEdge({ archived: false, title: 'Postdoctoral Associate' });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect((await persisted()).studentVisibilityReasons).toContain('missing_lead');

    const reclaim = await resolveAndRegate();
    expect(reclaim.lagging).toBe(1);
    expect(reclaim.tally['materialized-lead']).toBe(1);
    expect((await persisted()).studentVisibilityTier).toBe('student_ready');
  }, 120000);

  it('revisits a row whose only lead edge points at an archived person record', async () => {
    await seedRejectedLeadEdge({ archived: false, personArchived: true });
    const reclaim = await resolveAndRegate();
    expect(reclaim.lagging).toBe(1);
    expect(reclaim.tally['materialized-lead']).toBe(1);
  }, 120000);

  it('leaves a row alone once it holds a lead the gate accepts', async () => {
    await resolveAndRegate();
    const second = await reclaimInferredPiLeads({ apply: true, scope: 'all' });
    expect(second.lagging).toBe(0);
    expect(second.tally['materialized-lead']).toBe(0);
  }, 120000);

  it('reports an unresolved row as unresolved rather than counting the edge it looked past', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('observations').updateMany({}, { $set: { value: 'netid:nobody.here' } });
    await seedRejectedLeadEdge({ archived: true });

    const reclaim = await reclaimInferredPiLeads({ apply: true, scope: 'all' });
    expect(reclaim.lagging).toBe(1);
    expect(reclaim.tally['materialized-lead']).toBe(0);
    expect(reclaim.tally['still-unresolved']).toBe(1);
  }, 120000);
});
