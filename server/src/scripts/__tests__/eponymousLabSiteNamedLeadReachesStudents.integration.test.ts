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

import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runStudentVisibilityGate } from '../../services/studentVisibilityGateService';
import { runLabSiteNamedLeadAttachment } from '../attachLabSiteNamedLeads';

const SLUG = 'synthetic-eponymous-neonatal-lab';
const RESEARCH_HOME = 'https://medicine.yale.edu/lab/quimby/';
const PEOPLE_PAGE = `${RESEARCH_HOME}people/`;
const PROFILE_URL = 'https://medicine.yale.edu/profile/robin-quimby/';
const LEAD_NAME = 'Robin Quimby';
const SHORT_DESCRIPTION =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const FULL_DESCRIPTION =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

const readPages = async (researchHomeUrl: string) => [
  { url: researchHomeUrl, html: `<a href="${PEOPLE_PAGE}">Our people</a>` },
  { url: PEOPLE_PAGE, html: `<a href="/profile/robin-quimby/">${LEAD_NAME}, PhD</a>` },
];

const persisted = () =>
  ResearchEntity.findOne({ slug: SLUG }).lean<{
    _id: mongoose.Types.ObjectId;
    studentVisibilityTier?: string;
    studentVisibilityReasons?: string[];
  }>();

const servedLeadNames = async (): Promise<string[]> => {
  const detail = await getResearchGroupDetail(SLUG);
  return (detail?.members || [])
    .filter((member) => member.role === 'pi')
    .map((member) => String(member.user?.displayName || ''))
    .filter(Boolean);
};

describe("an eponymous lab's own site supplies the lead it was held for (#1930)", () => {
  let replSet: MongoMemoryReplSet;
  let personId: mongoose.Types.ObjectId;
  let entityId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

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

    const researcher = await Researcher.create({
      schemaVersion: 1,
      displayName: LEAD_NAME,
      firstName: 'Robin',
      lastName: 'Quimby',
      status: 'ACTIVE',
      archived: false,
      profile: { title: 'Professor of Pediatrics' },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PROFILE_URL,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
    });
    personId = researcher._id as mongoose.Types.ObjectId;

    const entity = await ResearchEntity.create({
      slug: SLUG,
      name: 'Quimby Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology', 'Health services research'],
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: ['missing_lead'],
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: RESEARCH_HOME,
      sourceUrls: [RESEARCH_HOME],
      fieldProvenance: {
        shortDescription: { sourceName: 'lab-microsite-description', sourceUrl: RESEARCH_HOME },
        fullDescription: { sourceName: 'lab-microsite-description', sourceUrl: RESEARCH_HOME },
      },
    });
    entityId = entity._id as mongoose.Types.ObjectId;
  });

  it('serves nobody while the lead edge is missing, then serves the site-named PI', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    const held = await persisted();
    expect(held?.studentVisibilityReasons).toContain('missing_lead');
    expect(await servedLeadNames()).toEqual([]);

    const report = await runLabSiteNamedLeadAttachment({ apply: true, maxApply: 5, readPages });
    expect(report.planned).toBe(1);
    expect(report.created).toBe(1);
    expect(report.studentReadyAfterRegate).toBe(1);

    const released = await persisted();
    expect(released?.studentVisibilityTier).toBe('student_ready');
    expect(released?.studentVisibilityReasons).not.toContain('missing_lead');
    expect(await servedLeadNames()).toEqual([LEAD_NAME]);
  }, 60000);

  it('reinstates an unjudged retired edge instead of minting a second one for the same person', async () => {
    await RoleAssignment.create({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'HISTORICAL',
      endedAt: new Date('2026-08-26T23:35:00Z'),
      confidence: 0.8,
      reviewStatus: 'UNREVIEWED',
      archived: true,
    });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(await servedLeadNames()).toEqual([]);

    const report = await runLabSiteNamedLeadAttachment({ apply: true, maxApply: 5, readPages });
    expect(report.reinstated).toBe(1);
    expect(report.created).toBe(0);
    expect(await RoleAssignment.countDocuments({ 'target.id': entityId })).toBe(1);
    const reinstated = await RoleAssignment.findOne({ 'target.id': entityId }).lean<{
      state?: string;
      endedAt?: Date;
    }>();
    expect(reinstated?.state).toBe('CURRENT');
    expect(reinstated?.endedAt).toBeUndefined();
    expect(await servedLeadNames()).toEqual([LEAD_NAME]);
  }, 60000);

  it('never re-mints over a retirement a lane already judged', async () => {
    await RoleAssignment.create({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.8,
      reviewStatus: 'DISPUTED',
      reviewNotes: 'Retired as a non-corroborating foreign-identity lead graft (#1203).',
      archived: true,
    });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const report = await runLabSiteNamedLeadAttachment({ apply: true, maxApply: 5, readPages });
    expect(report.planned).toBe(0);
    expect((report.refusedByReason as Record<string, number>).prior_edge_was_judged).toBe(1);
    expect(await servedLeadNames()).toEqual([]);
  }, 60000);
});
