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
import { getResearchGroupDetail } from '../../services/researchGroupService';
import { runResearchEntityWebsiteUrlBackfill } from '../backfillResearchEntityWebsiteUrls';

const SHORT_DESCRIPTION =
  'Studies how coastal marsh sediment chemistry responds to repeated tidal flooding in Long Island Sound.';
const FULL_DESCRIPTION =
  'The centre studies how coastal marsh sediment chemistry responds to repeated tidal flooding, combining field porewater sampling across a salinity gradient, laboratory incubation of sulfate reduction rates, and reactive transport modelling to predict where marsh carbon storage fails as sea level rises.';

const servedRow = (overrides: Record<string, unknown>) => ({
  studentVisibilityTier: 'student_ready',
  archived: false,
  shortDescription: SHORT_DESCRIPTION,
  fullDescription: FULL_DESCRIPTION,
  ...overrides,
});

const servedWebsiteUrl = async (slug: string) =>
  (await getResearchGroupDetail(slug))?.researchEntity?.websiteUrl;

const storedWebsiteUrl = async (slug: string) =>
  (await ResearchEntity.findOne({ slug }).lean())?.websiteUrl;

/**
 * The #2534 rows are stranded at the SERVED surface, not in the resolver: a student
 * opening the entity page sees no way in at all. This runs the real backfill against a
 * real collection and then re-reads the detail payload, because only that pairing shows
 * the derived site surviving both the write and the serve-time ownership gate.
 */
describe('a stranded organization row gains a served website from its own citation (#2534)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    await ResearchEntity.create([
      servedRow({
        slug: 'synthetic-exampletown-center',
        name: 'Exampletown Center for Coastal Policy',
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: '',
        sourceUrls: ['https://exampletown.yale.edu/people'],
      }),
      servedRow({
        slug: 'synthetic-examplebio-institute',
        name: 'Examplebio Institute',
        kind: 'institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://examplebio.yale.edu/members',
        sourceUrls: ['https://examplebio.yale.edu/members'],
      }),
      servedRow({
        slug: 'synthetic-school-hosted-center',
        name: 'Yale Center for Example Analysis',
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: '',
        sourceUrls: ['https://medicine.yale.edu/genetics/research/ycea/people/'],
      }),
      servedRow({
        slug: 'synthetic-unspelled-host-center',
        name: 'Exampleboard Foundation for Coastal Policy',
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: '',
        sourceUrls: ['https://unrelatedhost.yale.edu/people/faculty'],
      }),
      servedRow({
        slug: 'synthetic-person-scoped-area',
        name: 'Examplegroup',
        kind: 'lab',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl: 'https://examplegroup.yale.edu/people/members/',
        sourceUrls: ['https://examplegroup.yale.edu/people/members/'],
      }),
    ]);
  });

  it('serves no website before the backfill runs', async () => {
    expect(await servedWebsiteUrl('synthetic-exampletown-center')).toBeUndefined();
    expect(await servedWebsiteUrl('synthetic-school-hosted-center')).toBeUndefined();
    expect(await servedWebsiteUrl('synthetic-examplebio-institute')).toBe(
      'https://examplebio.yale.edu/members',
    );
  });

  it('serves the organization own site after the backfill applies', async () => {
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });

    expect(await storedWebsiteUrl('synthetic-exampletown-center')).toBe(
      'https://exampletown.yale.edu/',
    );
    expect(await servedWebsiteUrl('synthetic-exampletown-center')).toBe(
      'https://exampletown.yale.edu/',
    );
    expect(await servedWebsiteUrl('synthetic-school-hosted-center')).toBe(
      'https://medicine.yale.edu/genetics/research/ycea/',
    );
    expect(await servedWebsiteUrl('synthetic-examplebio-institute')).toBe(
      'https://examplebio.yale.edu/',
    );
  });

  it('leaves a person-scoped row on the same citation shape with no served website', async () => {
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });

    expect(await storedWebsiteUrl('synthetic-person-scoped-area')).toBe('');
    expect(await servedWebsiteUrl('synthetic-person-scoped-area')).toBeUndefined();
  });

  it('leaves an organization citing a host its name does not spell with no served website', async () => {
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });

    expect(await servedWebsiteUrl('synthetic-unspelled-host-center')).toBeUndefined();
  });
});
