/**
 * The stored half of #2285. Refusing the graft at ingest guards a value on its way
 * in; it does not rewrite a row that already serves one, because the row is
 * re-projected from its own already-active observation on every pass. So the
 * materializer refuses it too, and these cases prove the row heals by
 * re-derivation rather than by a repair script.
 *
 * Measured on Development: three live person-keyed rows were typed LAB and named
 * "Google Scholar", one of them student_ready, from a profile page's link section.
 * Two live sources assert it - ysm-faculty-directory at 0.8 and
 * official-profile-pi-backfill at 0.96 - so it was a recurring ingest defect, not
 * only stored residue.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'ysm-faculty-quilla-marrowbane';
const PROFILE_URL = 'https://medicine.yale.edu/profile/quilla-marrowbane/';
const OWN_NAME = 'Quilla Marrowbane Faculty Research';

const seedNameObservation = async (
  value: string,
  sourceName: string,
  confidence: number,
): Promise<void> => {
  for (const field of ['name', 'displayName']) {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: PROFILE_URL,
      confidence,
      observedAt: new Date('2026-08-01T00:00:00Z'),
      superseded: false,
    });
  }
};

const storedNames = async (): Promise<{ name?: string; displayName?: string }> => {
  const doc = (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean()) as {
    name?: string;
    displayName?: string;
  } | null;
  return { name: doc?.name, displayName: doc?.displayName };
};

describe('a scholarly-platform brand never survives as a stored name (#2285)', () => {
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
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedRowServingTheGraft = async (): Promise<void> => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Google Scholar',
      displayName: 'Google Scholar',
      entityType: 'LAB',
      kind: 'lab',
      sourceUrls: [PROFILE_URL],
      studentVisibilityTier: 'student_ready',
    });
  };

  it('re-derives the row own name when a rival observation exists', async () => {
    await seedRowServingTheGraft();
    await seedNameObservation('Google Scholar', 'official-profile-pi-backfill', 0.96);
    await seedNameObservation(OWN_NAME, 'bbs-research-track', 0.7);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    // The graft outranks the correct name 0.96 to 0.7, so weight alone would keep
    // serving it. Refusing it is what lets the lower-weighted truth win.
    expect(await storedNames()).toMatchObject({ name: OWN_NAME });
  });

  it('keeps the correction on a second pass, so it is not one-shot', async () => {
    await seedRowServingTheGraft();
    await seedNameObservation('Google Scholar', 'official-profile-pi-backfill', 0.96);
    await seedNameObservation(OWN_NAME, 'bbs-research-track', 0.7);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    expect(await storedNames()).toMatchObject({ name: OWN_NAME });
  });

  it('never leaves the record serving the brand, even with no rival name', async () => {
    await seedRowServingTheGraft();
    await seedNameObservation('Google Scholar', 'official-profile-pi-backfill', 0.96);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    const stored = await storedNames();
    // `name` only ever moves to a candidate that passes, so with no rival it may
    // stay put; `displayName` clears because every serve path falls back to `name`.
    // What must never happen is the brand being served as the display name.
    expect(stored.displayName).not.toBe('Google Scholar');
  });

  it('leaves a real name that merely contains a platform brand alone', async () => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Onofrey Lab GitHub',
      displayName: 'Onofrey Lab GitHub',
      entityType: 'LAB',
      kind: 'lab',
      sourceUrls: [PROFILE_URL],
      studentVisibilityTier: 'student_ready',
    });
    await seedNameObservation('Onofrey Lab GitHub', 'lab-microsite-description-llm', 0.82);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    expect(await storedNames()).toMatchObject({
      name: 'Onofrey Lab GitHub',
      displayName: 'Onofrey Lab GitHub',
    });
  });
});
