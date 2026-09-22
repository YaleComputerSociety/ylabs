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

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { appendObservations } from '../../scrapers/observationStore';
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runRetireDeployHostCitations } from '../retireEphemeralDeployHostCitations';
import { DEPLOY_HOST_CITATION_ROLLBACK_REASON } from '../retireEphemeralDeployHostCitationsCore';

const SLUG = 'fixture-deploy-host-citation-lab';
const ENTITY_KEY = 'dept:art:fixture-scholar';
const DEPLOY_HOST_URL =
  'https://fixture-nuxt-production-ab12c.ondigitalocean.app/people/faculty-and-staff/fixture-scholar';
const DEPLOY_HOST_ROSTER_URL =
  'https://fixture-nuxt-production-ab12c.ondigitalocean.app/people/faculty-and-staff';
const YALE_URL = 'https://www.art.yale.edu/people/faculty-and-staff/fixture-scholar';
const LOOKALIKE_HOST_URL = 'https://notondigitalocean.app/people/faculty-and-staff';
const SHORT_DESCRIPTION =
  'Studies how coastal marsh sediment chemistry responds to repeated tidal flooding in Long Island Sound.';
const FULL_DESCRIPTION =
  'The lab studies how coastal marsh sediment chemistry responds to repeated tidal flooding, combining field porewater sampling across a salinity gradient, laboratory incubation of sulfate reduction rates, and reactive transport modelling to predict where marsh carbon storage fails as sea level rises.';

const seedCitation = async (overrides: Record<string, unknown>) =>
  Observation.create({
    entityType: 'user',
    entityKey: ENTITY_KEY,
    field: 'bio',
    value: 'Paints large-format oil studies of tidal marsh light.',
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'dept-faculty-roster',
    confidence: 0.8,
    observedAt: new Date('2026-08-25T00:00:00Z'),
    superseded: false,
    ...overrides,
  });

const storedCitation = async (id: string) =>
  Observation.findById(id).lean<{
    superseded?: boolean;
    rollback?: { rolledBackAt?: Date; reason?: string };
  }>();

describe('deploy-host citations are refused, withheld, and retracted (#2805)', () => {
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
    await db.collection('observations').deleteMany({});
    await db.collection('research_entities').deleteMany({});
  });

  it('refuses to store a citation to a deploy host while storing the Yale page that serves it', async () => {
    const ctx = {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.8,
      dryRun: false,
    };
    const input = (sourceUrl: string) => ({
      entityType: 'user' as const,
      entityKey: ENTITY_KEY,
      field: 'profileUrls',
      value: { departmental: sourceUrl },
      sourceUrl,
    });

    const refused = await appendObservations([input(DEPLOY_HOST_URL)], ctx);
    const accepted = await appendObservations([input(YALE_URL)], ctx);

    expect(refused).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
    expect(accepted.inserted).toBe(1);
    expect(await Observation.countDocuments({ sourceUrl: DEPLOY_HOST_URL })).toBe(0);
    expect(await Observation.countDocuments({ sourceUrl: YALE_URL })).toBe(1);
  }, 60000);

  it('withholds a stored deploy host from the served detail payload a student reads', async () => {
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Fixture Deploy Host Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      sourceUrls: [DEPLOY_HOST_ROSTER_URL, YALE_URL, LOOKALIKE_HOST_URL],
    });

    const detail = await getResearchGroupDetail(SLUG);
    const servedSourceUrls = detail?.researchEntity?.sourceUrls ?? [];

    expect(servedSourceUrls).not.toContain(DEPLOY_HOST_ROSTER_URL);
    expect(servedSourceUrls).toContain(YALE_URL);
    expect(servedSourceUrls).toContain(LOOKALIKE_HOST_URL);
  }, 60000);

  it('retracts the stored rows through the engine retraction path and reports zero remaining', async () => {
    const activeDeployHost = await seedCitation({ sourceUrl: DEPLOY_HOST_URL });
    const supersededDeployHost = await seedCitation({
      sourceUrl: DEPLOY_HOST_ROSTER_URL,
      field: 'imageUrl',
      superseded: true,
    });
    const legitimateYale = await seedCitation({ sourceUrl: YALE_URL, field: 'title' });
    const lookalikeHost = await seedCitation({ sourceUrl: LOOKALIKE_HOST_URL, field: 'title' });
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Fixture Deploy Host Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
      sourceUrls: [DEPLOY_HOST_ROSTER_URL],
    });

    const dryRun = await runRetireDeployHostCitations({ dryRun: true });
    expect(dryRun.mode).toBe('dry-run');
    expect(dryRun.plan.activeToRetire).toBe(1);
    expect(dryRun.plan.supersededToStamp).toBe(1);
    expect(dryRun.retiredActive).toBe(0);
    expect(await storedCitation(activeDeployHost.id)).toMatchObject({ superseded: false });

    const applied = await runRetireDeployHostCitations({ dryRun: false });

    expect(applied.retiredActive).toBe(1);
    expect(applied.stampedSuperseded).toBe(1);
    expect(applied.citationsRemaining).toEqual({
      activeBefore: 1,
      activeAfter: 0,
      inReadScopeAfter: 0,
    });
    expect(applied.entitiesStillStoringDeployHost).toEqual({
      entities: 1,
      websiteUrl: 0,
      sourceUrls: 1,
    });

    const retired = await storedCitation(activeDeployHost.id);
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toBe(DEPLOY_HOST_CITATION_ROLLBACK_REASON);
    expect(retired?.rollback?.rolledBackAt).toBeInstanceOf(Date);

    const stamped = await storedCitation(supersededDeployHost.id);
    expect(stamped?.rollback?.reason).toBe(DEPLOY_HOST_CITATION_ROLLBACK_REASON);

    const untouchedYale = await storedCitation(legitimateYale.id);
    expect(untouchedYale?.superseded).toBe(false);
    expect(untouchedYale?.rollback?.rolledBackAt).toBeUndefined();

    const untouchedLookalike = await storedCitation(lookalikeHost.id);
    expect(untouchedLookalike?.superseded).toBe(false);
    expect(untouchedLookalike?.rollback?.rolledBackAt).toBeUndefined();
  }, 60000);

  it('shares one blast-radius budget across the retire and rollback-stamp sets', async () => {
    await seedCitation({ sourceUrl: DEPLOY_HOST_URL });
    await seedCitation({ sourceUrl: DEPLOY_HOST_URL, field: 'title' });
    await seedCitation({ sourceUrl: DEPLOY_HOST_ROSTER_URL, field: 'imageUrl', superseded: true });

    const applied = await runRetireDeployHostCitations({ dryRun: false, limit: 2 });

    expect(applied.retiredActive).toBe(2);
    expect(applied.stampedSuperseded).toBe(0);
    expect(applied.citationsRemaining.inReadScopeAfter).toBe(1);
  }, 60000);
});
