import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { retireSiteGraftFromHolder, type RetargetRow } from '../retargetForeignLabWebsites';

interface HolderDocument {
  name?: string;
  displayName?: string;
  fullDescription?: string;
  shortDescription?: string;
  methods?: string[];
  currentUndergradCount?: number;
  undergradEvidenceQuote?: string;
}

const loadHolder = async (): Promise<HolderDocument | null> =>
  (await ResearchEntity.findOne({
    slug: 'ysm-faculty-amit-khanna',
  }).lean()) as HolderDocument | null;

const APOLLO_SITE = 'https://apollo-lab-yale.github.io';
const PROFILE_URL = 'https://medicine.yale.edu/profile/amit-khanna/';

const khannaRow: RetargetRow = {
  holderSlug: 'ysm-faculty-amit-khanna',
  holderName: 'APOLLO LAB, Yale University',
  holderEntityType: 'LAB',
  holderKind: 'lab',
  holderLeadName: 'Amit Khanna',
  holderVisibilityTier: 'student_ready',
  websiteUrl: APOLLO_SITE,
  profileUrl: PROFILE_URL,
  slotNames: ['APOLLO LAB, Yale University'],
  observationIds: [],
  manuallyLockedFields: [],
  declaredLead: 'Daniel Rakita',
  siteName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
  evidenceUrl: `${APOLLO_SITE}/team/`,
  decision: 'RETARGET',
  targetSlug: 'rakita-lab-dr877',
};

async function seedObservation(
  field: string,
  value: unknown,
  sourceUrl: string,
  overrides: Record<string, unknown> = {},
) {
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: 'ysm-faculty-amit-khanna',
    field,
    value,
    sourceUrl,
    sourceName: sourceUrl.includes('apollo')
      ? 'lab-microsite-description-llm'
      : 'ysm-faculty-directory',
    sourceId: new mongoose.Types.ObjectId(),
    scrapeRunId: new mongoose.Types.ObjectId(),
    confidence: 0.8,
    observedAt: new Date('2026-08-28T00:00:00.000Z'),
    superseded: false,
    observationFingerprint: `${field}|${sourceUrl}|${JSON.stringify(value)}`,
    ...overrides,
  });
}

describe('retireSiteGraftFromHolder', () => {
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
    for (const name of ['research_entities', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: 'ysm-faculty-amit-khanna',
      name: 'APOLLO LAB, Yale University',
      kind: 'lab',
      entityType: 'LAB',
      fullDescription: 'We develop algorithms for fast planning, learning, and optimization.',
      shortDescription: 'Develops algorithms for fast planning, learning, and optimization.',
      methods: ['planning', 'learning', 'optimization'],
      currentUndergradCount: 10,
      undergradEvidenceQuote: 'Undergraduate Students',
    });
  });

  it("falls a description back to the record's own profile rather than blanking it", async () => {
    await seedObservation(
      'fullDescription',
      'We develop algorithms for fast planning, learning, and optimization.',
      APOLLO_SITE,
    );
    await seedObservation(
      'fullDescription',
      'Artificial Intelligence Applications in Surgery',
      PROFILE_URL,
    );

    const result = await retireSiteGraftFromHolder(khannaRow);
    expect(result.observationsRetired).toBe(1);

    const holder = await loadHolder();
    expect(holder?.fullDescription).toBe('Artificial Intelligence Applications in Surgery');
    const survivor = await Observation.findOne({ sourceUrl: PROFILE_URL }).lean();
    expect(survivor?.superseded).toBe(false);
  });

  it('unsets a field the site was the only source of, rather than serving a wrong value', async () => {
    await seedObservation('currentUndergradCount', 10, `${APOLLO_SITE}/team/`);
    await seedObservation('methods', ['planning', 'learning'], APOLLO_SITE);

    await retireSiteGraftFromHolder(khannaRow);

    const holder = await loadHolder();
    expect(holder?.currentUndergradCount).toBeUndefined();
    expect(holder?.methods).toBeUndefined();
  });

  it('retires every observation the site wrote, including ones with no document field', async () => {
    await seedObservation('undergradAccessEvidence', { openToUndergrads: 'yes' }, APOLLO_SITE);
    await seedObservation('sourceContentHash', 'abc123', APOLLO_SITE);
    await seedObservation('lastObservedAt', '2026-08-28T10:53:26.017Z', APOLLO_SITE);

    const result = await retireSiteGraftFromHolder(khannaRow);
    expect(result.observationsRetired).toBe(3);
    expect(await Observation.countDocuments({ superseded: { $ne: true } })).toBe(0);
  });

  it('retires nothing the record sourced itself, even while correcting its name', async () => {
    await seedObservation('departments', ['Colorectal Surgery'], PROFILE_URL);
    await seedObservation(
      'fullDescription',
      'Artificial Intelligence Applications in Surgery',
      PROFILE_URL,
    );

    const result = await retireSiteGraftFromHolder(khannaRow);
    expect(result.observationsRetired).toBe(0);
    expect(await Observation.countDocuments({ superseded: { $ne: true } })).toBe(2);
    const holder = await loadHolder();
    expect(holder?.fullDescription).toBe(
      'We develop algorithms for fast planning, learning, and optimization.',
    );
  });

  it("renames the record off the lab's name, so the lab outranks it for its own name", async () => {
    const result = await retireSiteGraftFromHolder(khannaRow);
    expect(result.documentFieldsCorrected).toBeGreaterThan(0);
    const holder = await loadHolder();
    expect(holder?.name).toBe('Amit Khanna Faculty Research');
    expect(holder?.displayName).toBeUndefined();
  });

  it('prefers a surviving name observation over the synthesized fallback', async () => {
    await seedObservation('name', 'Khanna Colorectal Surgery Lab', PROFILE_URL);

    await retireSiteGraftFromHolder(khannaRow);

    const holder = await loadHolder();
    expect(holder?.name).toBe('Khanna Colorectal Surgery Lab');
  });

  it('leaves a name the slot did not write, so an unrelated rename is never undone', async () => {
    await ResearchEntity.updateOne(
      { slug: khannaRow.holderSlug },
      { $set: { name: 'Khanna Surgical Robotics Lab' } },
    );

    await retireSiteGraftFromHolder({ ...khannaRow, holderName: 'Khanna Surgical Robotics Lab' });

    const holder = await loadHolder();
    expect(holder?.name).toBe('Khanna Surgical Robotics Lab');
  });

  it('never touches a manually locked field', async () => {
    await ResearchEntity.updateOne(
      { slug: khannaRow.holderSlug },
      { $set: { manuallyLockedFields: ['fullDescription'] } },
    );
    await seedObservation(
      'fullDescription',
      'We develop algorithms for fast planning.',
      APOLLO_SITE,
    );

    await retireSiteGraftFromHolder({ ...khannaRow, manuallyLockedFields: ['fullDescription'] });

    const holder = await loadHolder();
    expect(holder?.fullDescription).toBe(
      'We develop algorithms for fast planning, learning, and optimization.',
    );
  });

  it('matches the site by host, so a subpath of the same site still counts', async () => {
    await seedObservation(
      'undergradEvidenceQuote',
      'Undergraduate Students',
      `${APOLLO_SITE}/team/`,
    );

    const result = await retireSiteGraftFromHolder(khannaRow);
    expect(result.observationsRetired).toBe(1);
    const holder = await loadHolder();
    expect(holder?.undergradEvidenceQuote).toBeUndefined();
  });

  it('does nothing for a row whose website is not a URL', async () => {
    await seedObservation('fullDescription', 'anything', APOLLO_SITE);
    const result = await retireSiteGraftFromHolder({ ...khannaRow, websiteUrl: 'lab website' });
    expect(result).toEqual({ observationsRetired: 0, documentFieldsCorrected: 0 });
  });
});
