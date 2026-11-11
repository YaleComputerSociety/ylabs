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

import { parseArgs, runMintFraNamedResearchers } from '../mintFraNamedResearchers';

const TARGET = {
  _id: new mongoose.Types.ObjectId(),
  slug: 'synthetic-fra-wren-halvorsby',
  name: 'Wren Halvorsby Faculty Research',
  profileUrl: 'https://ysph.yale.edu/profile/wren-halvorsby/',
};
const BYSTANDER = {
  _id: new mongoose.Types.ObjectId(),
  slug: 'synthetic-fra-ottilie-brasken',
  name: 'Ottilie Brasken Faculty Research',
  profileUrl: 'https://medicine.yale.edu/profile/ottilie-brasken/',
};
const NOT_MISSING_LEAD_SLUG = 'synthetic-fra-has-lead';
const NO_NAMED_LEAD_SLUG = 'synthetic-fra-unnamed-center';

const db = () => {
  const database = mongoose.connection.db;
  if (!database) throw new Error('no db');
  return database;
};

const insertCandidate = (row: typeof TARGET) =>
  db()
    .collection('research_entities')
    .insertOne({
      _id: row._id,
      slug: row.slug,
      name: row.name,
      displayName: row.name,
      entityType: 'FACULTY_RESEARCH_PROFILE',
      schemaVersion: 1,
      archived: false,
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: ['missing_lead'],
      sourceUrls: [row.profileUrl],
    });

const roleCountFor = (id: mongoose.Types.ObjectId) =>
  db().collection('role_assignments').countDocuments({ 'target.id': id });

const run = (...argv: string[]) => runMintFraNamedResearchers(parseArgs(argv));

describe('research-entity:mint-fra-named-researchers --slug scope (#5773)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'directory_removals',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db().collection(name).deleteMany({});
    }
    await insertCandidate(TARGET);
    await insertCandidate(BYSTANDER);
    await db()
      .collection('research_entities')
      .insertMany([
        {
          slug: NOT_MISSING_LEAD_SLUG,
          name: 'Synthetic Led Lab',
          schemaVersion: 1,
          archived: false,
          studentVisibilityReasons: ['missing_action_evidence'],
          sourceUrls: [],
        },
        {
          slug: NO_NAMED_LEAD_SLUG,
          name: 'Center for Synthetic Studies',
          schemaVersion: 1,
          archived: false,
          studentVisibilityReasons: ['missing_lead'],
          sourceUrls: [],
        },
      ]);
  });

  it('plans every candidate when no --slug is given, exactly as before', async () => {
    const report = await run();
    expect(report.mode).toBe('dry-run');
    expect(report.plannedMints).toBe(2);
    expect(report).not.toHaveProperty('scopedSlugs');
    expect(await db().collection('researchers').countDocuments()).toBe(0);
  });

  it('plans only the named row in a dry run', async () => {
    const report = await run(`--slug=${TARGET.slug}`);
    expect(report.mode).toBe('dry-run');
    expect(report.scopedSlugs).toEqual([TARGET.slug]);
    expect(report.leadBlockedExamined).toBe(1);
    expect(report.plannedMints).toBe(1);
    expect(report.minted).toBe(0);
    expect(await db().collection('researchers').countDocuments()).toBe(0);
  });

  it('mints only the named row on apply and leaves the other candidate untouched', async () => {
    const bystanderBefore = await db()
      .collection('research_entities')
      .findOne({ _id: BYSTANDER._id });

    const report = await run('--apply', '--confirm-mint-fra-researchers', '--slug', TARGET.slug);

    expect(report.plannedMints).toBe(1);
    expect(report.minted).toBe(1);
    expect(report.attached).toBe(1);
    const researchers = await db().collection('researchers').find().toArray();
    expect(researchers.map((r) => r.profileLinks?.[0]?.url)).toEqual([TARGET.profileUrl]);
    expect(await roleCountFor(TARGET._id)).toBe(1);
    expect(await roleCountFor(BYSTANDER._id)).toBe(0);
    expect(await db().collection('research_entities').findOne({ _id: BYSTANDER._id })).toEqual(
      bystanderBefore,
    );
  });

  it('accepts a comma-separated list', async () => {
    const report = await run(`--slug=${TARGET.slug},${BYSTANDER.slug}`);
    expect(report.scopedSlugs).toEqual([TARGET.slug, BYSTANDER.slug]);
    expect(report.plannedMints).toBe(2);
  });

  it.each([
    ['synthetic-fra-no-such-row', 'no research entity has this slug'],
    [NOT_MISSING_LEAD_SLUG, 'not missing_lead'],
    [NO_NAMED_LEAD_SLUG, 'no named lead'],
  ])('fails closed for %s with the reason "%s"', async (slug, reason) => {
    await expect(
      run('--apply', '--confirm-mint-fra-researchers', `--slug=${slug}`),
    ).rejects.toThrow(new RegExp(`${slug}: ${reason}`));
    expect(await db().collection('researchers').countDocuments()).toBe(0);
    expect(await db().collection('role_assignments').countDocuments()).toBe(0);
  });

  it('fails closed for an existing role assignment', async () => {
    await db()
      .collection('role_assignments')
      .insertOne({
        personId: new mongoose.Types.ObjectId(),
        target: { kind: 'RESEARCH_ENTITY', id: TARGET._id },
        role: 'PI',
        state: 'CURRENT',
        archived: false,
      });
    await expect(run(`--slug=${TARGET.slug}`)).rejects.toThrow(
      /already has a current role assignment/,
    );
  });

  it('refuses the whole run when any one named slug is not a candidate', async () => {
    await expect(
      run(
        '--apply',
        '--confirm-mint-fra-researchers',
        `--slug=${TARGET.slug},${NOT_MISSING_LEAD_SLUG}`,
      ),
    ).rejects.toThrow(/not mint candidates, so nothing was planned or written/);
    expect(await db().collection('researchers').countDocuments()).toBe(0);
  });

  it('rejects an empty --slug', () => {
    expect(() => parseArgs(['--slug='])).toThrow(/at least one research entity slug/);
  });
});
