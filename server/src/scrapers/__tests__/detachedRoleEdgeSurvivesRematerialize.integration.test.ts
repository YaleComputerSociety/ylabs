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

import { materializeCanonicalMembership } from '../canonicalMembershipMaterializer';
import { getResearchGroupDetail, PUBLIC_LEAD_ROLES } from '../../services/researchGroupService';
import { retireSurnameClashLeadGrafts } from '../../scripts/retireSurnameClashLeadGrafts';

const SLUG = 'ysm-faculty-robin-quimby';
const SOURCE_URL = 'https://medicine.yale.edu/profile/quimby/';
const SHORT_DESCRIPTION =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const FULL_DESCRIPTION =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

const db = () => {
  const connection = mongoose.connection.db;
  if (!connection) throw new Error('no db');
  return connection;
};

const servedLeadNames = async (): Promise<string[]> => {
  const detail = await getResearchGroupDetail(SLUG);
  return (detail?.members || [])
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => String(member.user?.displayName || ''))
    .filter(Boolean)
    .sort();
};

const roleEdgeFor = async (displayName: string) => {
  const person = await db().collection('researchers').findOne({ displayName });
  if (!person) return null;
  return db().collection('role_assignments').findOne({ personId: person._id, role: 'PI' });
};

/**
 * Re-observes a lead exactly as a scrape sweep does, so the assertions below
 * exercise the real upsert rather than a stand-in for it.
 */
const reobserveLead = async (input: {
  entityId: mongoose.Types.ObjectId;
  displayName: string;
  netid: string;
}) =>
  materializeCanonicalMembership(
    input.entityId.toHexString(),
    {
      legacyRole: 'pi',
      displayName: input.displayName,
      evidenceStatus: 'verified',
      isCurrentMember: true,
      confidence: 0.9,
      rosterProvenance: {
        sourceName: 'ysm-faculty',
        sourceUrl: SOURCE_URL,
        observedAt: new Date(),
      },
    },
    { netid: input.netid, email: `${input.netid}@example.invalid`, displayName: input.displayName },
  );

describe('a detached role edge survives the next materialize pass (#3143)', () => {
  let replSet: MongoMemoryReplSet;
  let entityId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedLead = async (input: { displayName: string; netid: string; confidence: number }) => {
    const personId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    await db()
      .collection('accounts')
      .insertOne({
        _id: accountId,
        netid: input.netid,
        email: `${input.netid}@example.invalid`,
        status: 'UNKNOWN',
        archived: false,
      });
    await db()
      .collection('researchers')
      .insertOne({
        _id: personId,
        schemaVersion: 1,
        displayName: input.displayName,
        accountId,
        identifiers: { netid: input.netid },
        profile: { title: 'Associate Professor' },
        status: 'ACTIVE',
        profileLinks: [],
        archived: false,
      });
    await db()
      .collection('role_assignments')
      .insertOne({
        personId,
        schemaVersion: 1,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'PI',
        state: 'CURRENT',
        confidence: input.confidence,
        reviewStatus: 'UNREVIEWED',
        archived: false,
        rosterProvenance: {
          sourceName: 'ysm-faculty',
          sourceUrl: SOURCE_URL,
          observedAt: new Date(),
        },
      });
    return personId;
  };

  beforeEach(async () => {
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'accounts',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db().collection(name).deleteMany({});
    }

    entityId = new mongoose.Types.ObjectId();
    await db()
      .collection('research_entities')
      .insertOne({
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
        websiteUrl: SOURCE_URL,
        sourceUrls: [SOURCE_URL],
        fieldProvenance: {
          shortDescription: { sourceName: 'ysm-faculty', sourceUrl: SOURCE_URL },
          fullDescription: { sourceName: 'ysm-faculty', sourceUrl: SOURCE_URL },
          displayName: { sourceName: 'ysm-faculty', sourceUrl: SOURCE_URL },
        },
      });

    await seedLead({ displayName: 'Robin Quimby', netid: 'rq111', confidence: 0.7 });
    await seedLead({ displayName: 'Pradeep Quimby', netid: 'pq222', confidence: 0.9 });
    await retireSurnameClashLeadGrafts({ dryRun: false });
  });

  it('detaches the stranger before any re-observation', async () => {
    expect(await servedLeadNames()).toEqual(['Robin Quimby']);
    expect(await roleEdgeFor('Pradeep Quimby')).toMatchObject({
      archived: true,
      reviewStatus: 'DISPUTED',
    });
  }, 30000);

  it('keeps the stranger detached when the source listing is observed again', async () => {
    await reobserveLead({ entityId, displayName: 'Pradeep Quimby', netid: 'pq222' });

    const edge = await roleEdgeFor('Pradeep Quimby');
    expect(edge).toMatchObject({ archived: true, reviewStatus: 'DISPUTED' });
    expect(String(edge?.reviewNotes)).toContain('#2768');
    expect(await servedLeadNames()).toEqual(['Robin Quimby']);
  }, 30000);

  it('does not duplicate the detached edge instead of resurrecting it', async () => {
    await reobserveLead({ entityId, displayName: 'Pradeep Quimby', netid: 'pq222' });

    const person = await db().collection('researchers').findOne({ displayName: 'Pradeep Quimby' });
    const edges = await db()
      .collection('role_assignments')
      .find({ personId: person?._id, 'target.id': entityId, role: 'PI' })
      .toArray();
    expect(edges).toHaveLength(1);
  }, 30000);

  it('still records the re-observed evidence on the detached edge', async () => {
    await reobserveLead({ entityId, displayName: 'Pradeep Quimby', netid: 'pq222' });

    expect(await roleEdgeFor('Pradeep Quimby')).toMatchObject({
      archived: true,
      state: 'CURRENT',
      confidence: 0.9,
    });
  }, 30000);

  it('still attaches a lead nobody disputed', async () => {
    await reobserveLead({ entityId, displayName: 'Robin Quimby', netid: 'rq111' });
    expect(await roleEdgeFor('Robin Quimby')).toMatchObject({
      archived: false,
      reviewStatus: 'UNREVIEWED',
    });
    expect(await servedLeadNames()).toEqual(['Robin Quimby']);
  }, 30000);

  it('mints a lead the entity has never seen', async () => {
    await reobserveLead({ entityId, displayName: 'Dana Quimby', netid: 'dq444' });
    expect(await roleEdgeFor('Dana Quimby')).toMatchObject({ archived: false });
  }, 30000);
});
