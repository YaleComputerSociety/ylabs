import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

const gateMocks = vi.hoisted(() => ({
  planStudentVisibilityGate: vi.fn(async () => [] as unknown[]),
  applyStudentVisibilityGatePlans: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

vi.mock('../../services/studentVisibilityGateService', () => ({
  planStudentVisibilityGate: gateMocks.planStudentVisibilityGate,
  applyStudentVisibilityGatePlans: gateMocks.applyStudentVisibilityGatePlans,
}));

import { getResearchGroupDetail } from '../../services/researchGroupService';
import type { SourceLinkProbeResult } from '../../services/sourceLinkHealth';
import { runRepairPromotionRegressedWebsiteUrls } from '../repairPromotionRegressedWebsiteUrls';

const WATTS_DEAD = 'http://www.ngogochimp.commons.yale.edu/';
const WATTS_LIVE = 'https://anthropology.yale.edu/profile/david-watts';
const SOUS_WRONG_SUBJECT =
  'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research';
const SOUS_LIVE = 'https://sous.yale.edu/profile/john-sous';
const MANE_DEAD = 'https://ycga.yale.edu/';

const reachable = (url: string): SourceLinkProbeResult => ({
  status: 200,
  requestedUrl: url,
  finalUrl: url,
});

const defaultProbe = async (url: string): Promise<SourceLinkProbeResult> => {
  if (url === WATTS_LIVE || url === SOUS_LIVE) return reachable(url);
  return { errorCode: 'ENOTFOUND' };
};

const researchEntities = () => mongoose.connection.db!.collection('research_entities');

const SERVED_SHORT =
  'Studies wild chimpanzee social behavior across long-term field sites in East Africa.';
const SERVED_FULL =
  'The group studies wild chimpanzee social behavior at long-term field sites, combining daily behavioral follows, demographic censuses, and playback experiments to test how coalition structure shapes access to food and mating partners.';

const entityDoc = (overrides: Record<string, unknown> & { sourceUrls: string[] }) => ({
  kind: 'lab',
  entityType: 'LAB',
  archived: false,
  studentVisibilityTier: 'student_ready',
  studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
  departments: ['Anthropology'],
  researchAreas: ['Primate behavior', 'Behavioral ecology'],
  shortDescription: SERVED_SHORT,
  fullDescription: SERVED_FULL,
  ...overrides,
  fieldProvenance: {
    shortDescription: { sourceName: 'synthetic-source', sourceUrl: overrides.sourceUrls[0] },
    fullDescription: { sourceName: 'synthetic-source', sourceUrl: overrides.sourceUrls[0] },
    ...((overrides.fieldProvenance as Record<string, unknown>) ?? {}),
  },
});

describe('repair-promotion-regressed-website-urls against a real collection (#2583)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    await researchEntities().deleteMany({});
    await researchEntities().insertMany([
      entityDoc({
        slug: 'watts-dwatts',
        name: 'Synthetic Primate Behavior Group',
        websiteUrl: WATTS_DEAD,
        sourceUrls: [WATTS_LIVE, WATTS_DEAD],
        fieldProvenance: {
          websiteUrl: { sourceUrl: WATTS_DEAD, observedAt: new Date('2026-01-01T00:00:00.000Z') },
          name: { sourceUrl: WATTS_LIVE, observedAt: new Date('2026-01-01T00:00:00.000Z') },
        },
      }),
      entityDoc({
        slug: 'dept-physics-john-sous',
        name: 'Synthetic Condensed Matter Theory Group',
        websiteUrl: SOUS_WRONG_SUBJECT,
        sourceUrls: [SOUS_LIVE, SOUS_WRONG_SUBJECT],
      }),
      entityDoc({
        slug: 'ysm-faculty-shrikant-mane',
        name: 'Synthetic Genome Analysis Group',
        websiteUrl: MANE_DEAD,
        sourceUrls: ['https://medicine.yale.edu/profile/synthetic-person/'],
        fieldProvenance: {
          websiteUrl: { sourceUrl: MANE_DEAD, observedAt: new Date('2026-01-01T00:00:00.000Z') },
        },
      }),
    ]);
  });

  const stored = async (slug: string) => (await researchEntities().findOne({ slug })) ?? undefined;

  it('leaves the collection untouched on a dry run while still reporting the plan', async () => {
    const { plans, applied } = await runRepairPromotionRegressedWebsiteUrls({
      apply: false,
      confirm: false,
      probe: defaultProbe,
    });

    expect(applied).toBe(false);
    expect(plans.map((plan) => [plan.slug, plan.nextWebsiteUrl])).toEqual([
      ['watts-dwatts', WATTS_LIVE],
      ['dept-physics-john-sous', SOUS_LIVE],
      ['ysm-faculty-shrikant-mane', ''],
    ]);
    expect((await stored('watts-dwatts'))?.websiteUrl).toBe(WATTS_DEAD);
    expect((await stored('ysm-faculty-shrikant-mane'))?.websiteUrl).toBe(MANE_DEAD);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
    expect(gateMocks.planStudentVisibilityGate).not.toHaveBeenCalled();
  });

  it('serves the restored url, drops its stale provenance, and locks the field', async () => {
    await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });

    const watts = await stored('watts-dwatts');
    expect(watts?.websiteUrl).toBe(WATTS_LIVE);
    expect(watts?.manuallyLockedFields).toEqual(['websiteUrl']);
    expect(watts?.fieldProvenance).not.toHaveProperty('websiteUrl');
    expect(watts?.fieldProvenance).toHaveProperty('name');
    expect((await stored('dept-physics-john-sous'))?.websiteUrl).toBe(SOUS_LIVE);
  });

  it('unsets the dead url with its provenance and re-gates that row', async () => {
    await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });

    const mane = await stored('ysm-faculty-shrikant-mane');
    expect(mane).not.toHaveProperty('websiteUrl');
    expect(mane?.fieldProvenance).not.toHaveProperty('websiteUrl');
    expect(mane?.manuallyLockedFields).toEqual(['websiteUrl']);
    expect(gateMocks.planStudentVisibilityGate).toHaveBeenCalledWith({
      collection: 'research',
      mode: 'apply',
      recordIds: [String(mane?._id)],
    });
    expect(gateMocks.applyStudentVisibilityGatePlans).toHaveBeenCalled();
  });

  it('re-indexes the restored rows so the replaced dead url stops matching keyword search', async () => {
    await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });

    expect(meiliMocks.syncEntities).toHaveBeenCalledTimes(1);
    const [entityType, docs] = meiliMocks.syncEntities.mock.calls[0] as unknown as [
      string,
      { slug: string; websiteUrl?: string }[],
    ];
    expect(entityType).toBe('researchEntity');
    expect(docs.map((doc) => [doc.slug, doc.websiteUrl]).sort()).toEqual([
      ['dept-physics-john-sous', SOUS_LIVE],
      ['watts-dwatts', WATTS_LIVE],
    ]);
  });

  it('writes a row whose stored value carries stray whitespace instead of silently matching nothing', async () => {
    await researchEntities().updateOne(
      { slug: 'watts-dwatts' },
      { $set: { websiteUrl: `  ${WATTS_DEAD}  ` } },
    );

    const { plans } = await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });

    expect(plans.find((plan) => plan.slug === 'watts-dwatts')).toMatchObject({
      nextWebsiteUrl: WATTS_LIVE,
    });
    expect((await stored('watts-dwatts'))?.websiteUrl).toBe(WATTS_LIVE);
  });

  it('reports a write conflict rather than a repair when the row moves under it', async () => {
    const probeThatMovesTheRow = async (url: string): Promise<SourceLinkProbeResult> => {
      await researchEntities().updateOne(
        { slug: 'watts-dwatts' },
        { $set: { websiteUrl: 'https://example.edu/synthetic-concurrent-write' } },
      );
      return defaultProbe(url);
    };

    const { plans } = await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: probeThatMovesTheRow,
    });

    expect(plans.find((plan) => plan.slug === 'watts-dwatts')).toMatchObject({
      skipped: 'write_conflict',
      nextWebsiteUrl: undefined,
    });
    const watts = await stored('watts-dwatts');
    expect(watts?.websiteUrl).toBe('https://example.edu/synthetic-concurrent-write');
    expect(watts?.manuallyLockedFields).toBeUndefined();
  });

  it('refuses every row when the probe settles nothing, leaving all three served values alone', async () => {
    const { plans } = await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: async () => ({ errorCode: 'ERR_SSRF_BLOCKED' }),
    });

    expect(plans.map((plan) => plan.skipped)).toEqual([
      'probe_inconclusive',
      'probe_inconclusive',
      'probe_inconclusive',
    ]);
    expect((await stored('watts-dwatts'))?.websiteUrl).toBe(WATTS_DEAD);
    expect((await stored('dept-physics-john-sous'))?.websiteUrl).toBe(SOUS_WRONG_SUBJECT);
    expect((await stored('ysm-faculty-shrikant-mane'))?.websiteUrl).toBe(MANE_DEAD);
  });

  it('changes what the detail endpoint serves a student', async () => {
    const servedWebsiteUrl = async (slug: string) =>
      (await getResearchGroupDetail(slug))?.researchEntity?.websiteUrl;

    expect(await servedWebsiteUrl('watts-dwatts')).toBe(WATTS_DEAD);
    expect(await servedWebsiteUrl('dept-physics-john-sous')).toBe(SOUS_WRONG_SUBJECT);
    expect(await servedWebsiteUrl('ysm-faculty-shrikant-mane')).toBe(MANE_DEAD);

    await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });

    expect(await servedWebsiteUrl('watts-dwatts')).toBe(WATTS_LIVE);
    expect(await servedWebsiteUrl('dept-physics-john-sous')).toBe(SOUS_LIVE);
    expect(await servedWebsiteUrl('ysm-faculty-shrikant-mane')).toBeUndefined();
  });

  it('is re-runnable: a second apply finds the rows already locked and writes nothing new', async () => {
    await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });
    vi.clearAllMocks();

    const { plans } = await runRepairPromotionRegressedWebsiteUrls({
      apply: true,
      confirm: true,
      probe: defaultProbe,
    });

    expect(plans.map((plan) => plan.skipped)).toEqual([
      'website_url_manually_locked',
      'website_url_manually_locked',
      'website_url_manually_locked',
    ]);
    expect((await stored('watts-dwatts'))?.websiteUrl).toBe(WATTS_LIVE);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
    expect(gateMocks.planStudentVisibilityGate).not.toHaveBeenCalled();
  });
});
