import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runResearchDescriptionBackfill } from '../backfillResearchDescriptions';

const groundedSource =
  'The laboratory investigates quantum materials, superconductivity, and topological phases in ' +
  'electron lattice systems, developing spectroscopy methods to probe emergent correlated states ' +
  'across novel materials. The laboratory director studies these questions with students.';

const rewrittenFull =
  'The laboratory investigates quantum materials, superconductivity, and topological phases in ' +
  'electron lattice systems, developing spectroscopy methods to probe emergent correlated states ' +
  'across novel materials.';

const rewrittenShort =
  'Quantum materials and topological superconductivity research in electron lattice systems.';

const echoRewriter = async () => ({
  fullDescription: rewrittenFull,
  shortDescription: rewrittenShort,
});

const insertBlockedHome = async (id: mongoose.Types.ObjectId, slug: string) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  await db.collection('research_entities').insertOne({
    _id: id,
    slug,
    name: slug,
    displayName: slug,
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: ['thin_description'],
    fullDescription: groundedSource,
    websiteUrl: `https://example.edu/${slug}`,
    sourceUrls: [`https://example.edu/${slug}`],
  });
};

describe('runResearchDescriptionBackfill record-id scoping (#1913)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
  });

  it('promotes only the targeted home when a record id scopes the lane', async () => {
    const targetId = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    await insertBlockedHome(targetId, 'target-lab');
    await insertBlockedHome(otherId, 'other-lab');

    const scoped = await runResearchDescriptionBackfill({
      dryRun: true,
      recordIds: [targetId.toString()],
      rewriter: echoRewriter,
    });

    expect(scoped.scanned).toBe(1);
    expect(scoped.rewritten).toBe(1);
    expect(scoped.samples.map((sample) => sample.slug)).toEqual(['target-lab']);
  });

  it('scans every description-blocked home when no record id is supplied', async () => {
    await insertBlockedHome(new mongoose.Types.ObjectId(), 'target-lab');
    await insertBlockedHome(new mongoose.Types.ObjectId(), 'other-lab');

    const unscoped = await runResearchDescriptionBackfill({
      dryRun: true,
      rewriter: echoRewriter,
    });

    expect(unscoped.scanned).toBe(2);
    expect(unscoped.rewritten).toBe(2);
    expect(new Set(unscoped.samples.map((sample) => sample.slug))).toEqual(
      new Set(['target-lab', 'other-lab']),
    );
  });

  it('rewrites nothing when the scoped record id is not description-blocked', async () => {
    await insertBlockedHome(new mongoose.Types.ObjectId(), 'target-lab');
    const strangerId = new mongoose.Types.ObjectId();

    const scoped = await runResearchDescriptionBackfill({
      dryRun: true,
      recordIds: [strangerId.toString()],
      rewriter: echoRewriter,
    });

    expect(scoped.scanned).toBe(0);
    expect(scoped.rewritten).toBe(0);
    expect(scoped.samples).toEqual([]);
  });
});
