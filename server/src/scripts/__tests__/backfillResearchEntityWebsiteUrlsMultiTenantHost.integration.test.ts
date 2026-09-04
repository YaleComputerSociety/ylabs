import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runResearchEntityWebsiteUrlBackfill } from '../backfillResearchEntityWebsiteUrls';

const researchEntities = () => mongoose.connection.db!.collection('research_entities');

const entityDoc = (overrides: Record<string, unknown>) => ({
  kind: 'lab',
  entityType: 'LAB',
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

describe('research-entity website-url backfill on shared multi-tenant hosts (#2359)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await researchEntities().deleteMany({});
    await researchEntities().insertMany([
      entityDoc({
        slug: 'synthetic-shared-root-tenant-lab',
        name: 'Synthetic Shared Root Tenant Lab',
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
      entityDoc({
        slug: 'synthetic-shared-root-www-alias-lab',
        name: 'Synthetic Www Alias Tenant Lab',
        websiteUrl: 'https://www.csl.yale.edu/index.php',
        sourceUrls: ['https://www.csl.yale.edu/index.php', 'https://csl.yale.edu/~synthetic/'],
      }),
      entityDoc({
        slug: 'synthetic-multi-label-host-tenant-lab',
        name: 'Synthetic Multi Label Tenant Lab',
        websiteUrl: 'https://gauss.math.yale.edu/',
        sourceUrls: ['https://gauss.math.yale.edu/', 'https://gauss.math.yale.edu/~synthetic/'],
      }),
      entityDoc({
        slug: 'synthetic-computer-systems-lab',
        name: 'Computer Systems Lab',
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
      entityDoc({
        slug: 'synthetic-untouched-lab',
        name: 'Synthetic Untouched Lab',
        websiteUrl: 'https://belieflab.yale.edu/',
        sourceUrls: ['https://belieflab.yale.edu/'],
      }),
    ]);
  });

  const storedWebsiteUrl = async (slug: string) =>
    (await researchEntities().findOne({ slug }))?.websiteUrl;

  it('scans stored shared-host roots, including www and index.php forms', async () => {
    const result = await runResearchEntityWebsiteUrlBackfill({ dryRun: true });

    expect(result.samples.map((sample) => sample.slug).sort()).toEqual([
      'synthetic-multi-label-host-tenant-lab',
      'synthetic-shared-root-tenant-lab',
      'synthetic-shared-root-www-alias-lab',
    ]);
    expect(await storedWebsiteUrl('synthetic-shared-root-tenant-lab')).toBe(
      'https://csl.yale.edu/',
    );
  });

  it('apply clears a tenant root, re-picks a tenant page, and leaves the host owner alone', async () => {
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });

    expect(await storedWebsiteUrl('synthetic-shared-root-tenant-lab')).toBe('');
    expect(await storedWebsiteUrl('synthetic-shared-root-www-alias-lab')).toBe(
      'https://csl.yale.edu/~synthetic/',
    );
    expect(await storedWebsiteUrl('synthetic-multi-label-host-tenant-lab')).toBe(
      'https://gauss.math.yale.edu/~synthetic/',
    );
    expect(await storedWebsiteUrl('synthetic-computer-systems-lab')).toBe('https://csl.yale.edu/');
    expect(await storedWebsiteUrl('synthetic-untouched-lab')).toBe('https://belieflab.yale.edu/');
  });
});
