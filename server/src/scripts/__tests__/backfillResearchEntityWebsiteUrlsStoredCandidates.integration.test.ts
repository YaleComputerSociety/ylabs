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

const storedWebsiteUrl = async (slug: string) =>
  (await researchEntities().findOne({ slug }))?.websiteUrl;

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

describe('research-entity website-url backfill on shared multi-tenant hosts (#2359)', () => {
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
        kind: 'center',
        entityType: 'CENTER',
        websiteUrl: 'https://csl.yale.edu/',
        sourceUrls: ['https://csl.yale.edu/'],
      }),
      entityDoc({
        slug: 'synthetic-grafted-host-name-tenant-lab',
        name: 'Computer Systems Lab at Yale',
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

  it('scans stored shared-host roots, including www and index.php forms', async () => {
    const result = await runResearchEntityWebsiteUrlBackfill({ dryRun: true });

    expect(result.samples.map((sample) => sample.slug).sort()).toEqual([
      'synthetic-grafted-host-name-tenant-lab',
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
    expect(await storedWebsiteUrl('synthetic-grafted-host-name-tenant-lab')).toBe('');
    expect(await storedWebsiteUrl('synthetic-untouched-lab')).toBe('https://belieflab.yale.edu/');
  });
});

/**
 * The press refusal only reaches a student through the candidate query, which selects
 * rows by stored URL shape. An article matches none of the profile, listing or
 * multi-tenant shapes, so without its own selector arm the guard is never consulted on
 * the rows it exists for (#2532).
 */
describe('research-entity website-url backfill on press and news hosts (#2532)', () => {
  beforeEach(async () => {
    await researchEntities().deleteMany({});
    await researchEntities().insertMany([
      entityDoc({
        slug: 'synthetic-press-article-repickable-lab',
        name: 'Synthetic Press Article Repickable Lab',
        websiteUrl: 'https://news.yale.edu/2024/06/05/example-headline',
        sourceUrls: [
          'https://news.yale.edu/2024/06/05/example-headline',
          'https://examplelab.yale.edu/',
        ],
      }),
      entityDoc({
        slug: 'synthetic-press-article-only-lab',
        name: 'Synthetic Press Article Only Lab',
        websiteUrl: 'https://www.wsj.com/personal-finance/example-24057ac4',
        sourceUrls: ['https://www.wsj.com/personal-finance/example-24057ac4'],
      }),
      entityDoc({
        slug: 'synthetic-press-subdomain-lab',
        name: 'Synthetic Press Subdomain Lab',
        websiteUrl: 'https://edition.cnn.com/2026/01/02/example',
        sourceUrls: ['https://edition.cnn.com/2026/01/02/example'],
      }),
      entityDoc({
        slug: 'synthetic-press-lookalike-host-lab',
        name: 'Synthetic Press Lookalike Host Lab',
        websiteUrl: 'https://notnpr.example.org/lab/',
        sourceUrls: ['https://notnpr.example.org/lab/'],
      }),
    ]);
  });

  it('selects every stored press-host websiteUrl and no lookalike host', async () => {
    const result = await runResearchEntityWebsiteUrlBackfill({ dryRun: true });

    expect(result.samples.map((sample) => sample.slug).sort()).toEqual([
      'synthetic-press-article-only-lab',
      'synthetic-press-article-repickable-lab',
      'synthetic-press-subdomain-lab',
    ]);
  });

  it('apply re-picks a research home from evidence and otherwise clears the article', async () => {
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });

    expect(await storedWebsiteUrl('synthetic-press-article-repickable-lab')).toBe(
      'https://examplelab.yale.edu/',
    );
    expect(await storedWebsiteUrl('synthetic-press-article-only-lab')).toBe('');
    expect(await storedWebsiteUrl('synthetic-press-subdomain-lab')).toBe('');
    expect(await storedWebsiteUrl('synthetic-press-lookalike-host-lab')).toBe(
      'https://notnpr.example.org/lab/',
    );
  });

  it('does not re-promote a cleared article from the row that still cites it', async () => {
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });
    await runResearchEntityWebsiteUrlBackfill({ dryRun: false });

    expect(await storedWebsiteUrl('synthetic-press-article-only-lab')).toBe('');
  });

  it('writes only the rows a --slug scope names', async () => {
    const result = await runResearchEntityWebsiteUrlBackfill({
      dryRun: false,
      slugs: ['synthetic-press-article-only-lab'],
    });

    expect(result.scanned).toBe(1);
    expect(await storedWebsiteUrl('synthetic-press-article-only-lab')).toBe('');
    expect(await storedWebsiteUrl('synthetic-press-subdomain-lab')).toBe(
      'https://edition.cnn.com/2026/01/02/example',
    );
    expect(await storedWebsiteUrl('synthetic-press-article-repickable-lab')).toBe(
      'https://news.yale.edu/2024/06/05/example-headline',
    );
  });

  it('fails an apply whose slug scope selects no candidate row', async () => {
    await expect(
      runResearchEntityWebsiteUrlBackfill({
        dryRun: false,
        slugs: ['synthetic-press-lookalike-host-lab'],
      }),
    ).rejects.toThrow(/selected no candidate rows/);
    await expect(
      runResearchEntityWebsiteUrlBackfill({ dryRun: false, slugs: ['synthetic-absent-lab'] }),
    ).rejects.toThrow(/selected no candidate rows/);
  });
});
