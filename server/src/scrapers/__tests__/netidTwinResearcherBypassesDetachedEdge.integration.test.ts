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

const SLUG = 'ysm-faculty-marin-okonkwo';
const SOURCE_URL = 'https://medicine.yale.edu/profile/okonkwo/';
const NETID = 'mo9182';
const LEAD_NAME = 'Marin Okonkwo';
const SHORT_DESCRIPTION =
  'Studies airway inflammation in paediatric asthma using induced sputum cytology and lung-function testing.';
const FULL_DESCRIPTION =
  'The lab studies airway inflammation in paediatric asthma, combining induced sputum cytology, serial lung-function testing and inhaled-corticosteroid response trials to identify which children benefit from step-up therapy and which are harmed by it.';

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

describe('a netid twin cannot bypass a detached role edge (#3152)', () => {
  let replSet: MongoMemoryReplSet;
  let entityId: mongoose.Types.ObjectId;
  let detachedPersonId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  /**
   * The shape the exposure count is about: identity lives at `identifiers.netid`
   * with no `accountId`, which is how 385 live Development researchers are keyed.
   */
  const seedAccountlessLeadWithNetid = async (): Promise<mongoose.Types.ObjectId> => {
    const personId = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({
        _id: personId,
        schemaVersion: 1,
        displayName: LEAD_NAME,
        identifiers: { netid: NETID },
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
        confidence: 0.7,
        reviewStatus: 'DISPUTED',
        archived: true,
        reviewNotes: 'detached by an operator repair (#3152 fixture)',
        rosterProvenance: {
          sourceName: 'ysm-faculty',
          sourceUrl: SOURCE_URL,
          observedAt: new Date(),
        },
      });
    return personId;
  };

  const reobserveLead = async () =>
    materializeCanonicalMembership(
      entityId.toHexString(),
      {
        legacyRole: 'pi',
        displayName: LEAD_NAME,
        evidenceStatus: 'verified',
        isCurrentMember: true,
        confidence: 0.9,
        rosterProvenance: {
          sourceName: 'ysm-faculty',
          sourceUrl: SOURCE_URL,
          observedAt: new Date(),
        },
      },
      { netid: NETID, email: `${NETID}@example.invalid`, displayName: LEAD_NAME },
    );

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
        name: 'Okonkwo Paediatric Airway Lab',
        displayName: 'Okonkwo Paediatric Airway Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        departments: ['Pediatrics'],
        researchAreas: ['Asthma'],
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

    detachedPersonId = await seedAccountlessLeadWithNetid();
  });

  it('starts from a detached edge that the entity does not serve', async () => {
    expect(await servedLeadNames()).toEqual([]);
  }, 30000);

  it('resolves the next observation onto the netid holder instead of minting a twin', async () => {
    await reobserveLead();

    const holders = await db()
      .collection('researchers')
      .find({ archived: { $ne: true }, displayName: LEAD_NAME })
      .toArray();
    expect(holders).toHaveLength(1);
    expect(String(holders[0]._id)).toBe(String(detachedPersonId));
  }, 30000);

  it('keeps the detachment in force, so the entity still serves no lead', async () => {
    await reobserveLead();

    expect(await servedLeadNames()).toEqual([]);
    const edges = await db()
      .collection('role_assignments')
      .find({ 'target.id': entityId, role: 'PI' })
      .toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ archived: true, reviewStatus: 'DISPUTED' });
  }, 30000);

  /**
   * A netid an existing researcher already owns must converge onto one key rather
   * than stay split across `accounts.netid` and `researchers.identifiers.netid`,
   * because a detachment keyed to a person is only as durable as the guarantee
   * that the person has one row.
   */
  it('converges the two netid keys onto the adopted row', async () => {
    await reobserveLead();

    const account = await db().collection('accounts').findOne({ netid: NETID });
    expect(account).toBeTruthy();
    const adopted = await db().collection('researchers').findOne({ _id: detachedPersonId });
    expect(String(adopted?.accountId)).toBe(String(account?._id));
  }, 30000);
});
