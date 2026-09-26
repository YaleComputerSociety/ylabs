import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../researchGroupService';

const SLUG = 'fixture-private-address-lab';
const PRIVATE_URL = 'https://internal.example.edu/lab/';
const PUBLIC_URL = 'https://medicine.yale.edu/profile/fixture-scholar/';
const SHORT_DESCRIPTION =
  'Studies how coastal marsh sediment chemistry responds to repeated tidal flooding in Long Island Sound.';
const FULL_DESCRIPTION =
  'The lab studies how coastal marsh sediment chemistry responds to repeated tidal flooding, combining field porewater sampling across a salinity gradient, laboratory incubation of sulfate reduction rates, and reactive transport modelling to predict where marsh carbon storage fails as sea level rises.';

/**
 * `sourceLinkHealth` is an allowlist projection, and the detail route had its own
 * copy of it, so the routing axis reached the browse payload and silently vanished
 * on the page a student reads. This asserts the served surface rather than the
 * builder, because only the served surface caught that (#2556).
 */
describe('a private-address citation reaches the served detail payload (#2556)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Fixture Private Address Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
      shortDescription: SHORT_DESCRIPTION,
      fullDescription: FULL_DESCRIPTION,
      websiteUrl: PRIVATE_URL,
      sourceUrls: [PRIVATE_URL, PUBLIC_URL],
      sourceLinkHealth: [
        { url: PRIVATE_URL, healthStatus: 'UNKNOWN', privateAddressHost: true },
        { url: PUBLIC_URL, healthStatus: 'HEALTHY', httpStatusCode: 200 },
      ],
    });
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('serves the routing fact on the flagged citation and keeps the citation listed', async () => {
    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity;
    const health = served?.sourceLinkHealth ?? [];

    expect(health.find((entry) => entry.url === PRIVATE_URL)?.privateAddressHost).toBe(true);
    expect(health.find((entry) => entry.url === PUBLIC_URL)?.privateAddressHost).toBeUndefined();
    expect(served?.websiteUrl).toBe(PRIVATE_URL);
    expect(served?.sourceUrls).toContain(PRIVATE_URL);
  });
});
