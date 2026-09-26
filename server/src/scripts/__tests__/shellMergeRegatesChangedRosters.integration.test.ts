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
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const SLUG = 'ysm-faculty-rosalind-quimby';
const ROSTER_PAGE = 'https://medicine.yale.edu/profile/rosalind-quimby/';
const SHORT_DESCRIPTION =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const FULL_DESCRIPTION =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

const entityId = new mongoose.Types.ObjectId();
const canonicalId = new mongoose.Types.ObjectId();
const shellId = new mongoose.Types.ObjectId();

const servedLeadNames = async (): Promise<string[] | null> => {
  const detail = await getResearchGroupDetail(SLUG);
  if (!detail) return null;
  return detail.members
    .filter((member) => PUBLIC_LEAD_ROLES.has(member.role))
    .map((member) => String(member.user?.displayName || ''))
    .sort();
};

const storedEntity = async (): Promise<Record<string, any>> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const doc = await db.collection('research_entities').findOne({ _id: entityId });
  if (!doc) throw new Error('entity missing');
  return doc;
};

describe('folding a person shell re-gates the rosters it changed (#2952)', () => {
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
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }

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
      // Deliberately stale: the stored verdict describes a roster this row no longer
      // has, which is what a roster edit leaves behind when nothing re-gates.
      studentVisibilityTier: 'operator_review',
      studentVisibilityComputedTier: 'operator_review',
      studentVisibilityReasons: ['missing_lead'],
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: ROSTER_PAGE,
      sourceUrls: [ROSTER_PAGE],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl: ROSTER_PAGE },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl: ROSTER_PAGE },
        displayName: { sourceName: 'ysm-faculty', sourceUrl: ROSTER_PAGE },
      },
    });

    await db.collection('researchers').insertMany([
      {
        _id: canonicalId,
        schemaVersion: 1,
        displayName: 'Rosalind Quimby',
        accountId: new mongoose.Types.ObjectId(),
        identifiers: { netid: 'rq111' },
        profile: { title: 'Associate Professor' },
        status: 'ACTIVE',
        profileLinks: [],
        archived: false,
      },
      {
        _id: shellId,
        schemaVersion: 1,
        displayName: 'Rosalind Quimby',
        profile: { title: 'Associate Professor' },
        status: 'ACTIVE',
        profileLinks: [],
        archived: false,
      },
    ]);

    await db.collection('role_assignments').insertOne({
      personId: shellId,
      schemaVersion: 1,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      rosterProvenance: {
        sourceName: 'ysm-faculty',
        sourceUrl: ROSTER_PAGE,
        observedAt: new Date(),
      },
    });
  });

  it('does not serve the row while its stored verdict describes the pre-merge roster', async () => {
    expect(await servedLeadNames()).toBe(null);
  }, 120000);

  it('re-gates the row whose roster the merge edited, so the merged lead reaches students', async () => {
    const report = await dedupeAccountlessResearcherShells({ apply: true });
    expect(report).toMatchObject({
      shellsMerged: 1,
      roleAssignmentsRepointed: 1,
      rosterChangedEntities: 1,
      regatedEntities: 1,
    });

    const entity = await storedEntity();
    expect(entity.studentVisibilityTier).toBe('student_ready');
    expect(entity.studentVisibilityEvaluatedAt).toBeInstanceOf(Date);
    expect(await servedLeadNames()).toEqual(['Rosalind Quimby']);
  }, 120000);

  it('moves the lead edge to the surviving record rather than dropping it', async () => {
    await dedupeAccountlessResearcherShells({ apply: true });
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const live = await db
      .collection('role_assignments')
      .find({ archived: { $ne: true }, 'target.id': entityId })
      .toArray();
    expect(live).toHaveLength(1);
    expect(String(live[0].personId)).toBe(String(canonicalId));
    const shell = await db.collection('researchers').findOne({ _id: shellId });
    expect(shell?.archived).toBe(true);
    expect(String(shell?.dedupedIntoResearcherId)).toBe(String(canonicalId));
  }, 120000);

  it('re-gates nothing in a dry run', async () => {
    const report = await dedupeAccountlessResearcherShells({ apply: false });
    expect(report).toMatchObject({ shellsMerged: 1, rosterChangedEntities: 1, regatedEntities: 0 });
    const entity = await storedEntity();
    expect(entity.studentVisibilityTier).toBe('operator_review');
    expect(entity.studentVisibilityEvaluatedAt).toBe(undefined);
    expect(await servedLeadNames()).toBe(null);
  }, 120000);
});
