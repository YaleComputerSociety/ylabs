import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getResearchGroupDetail } from '../researchGroupService';

/**
 * An access signal's citation is an instruction to a student, not provenance, so a
 * citation the corpus knows is gone is withheld while the signal stays (#3267).
 *
 * The entity's own citations get the opposite treatment on purpose, and this suite
 * pins both halves side by side, because applying one policy to both is the mistake
 * the census was run to avoid.
 */
const SLUG = 'fixture-dead-access-signal-citation';
const GONE_URL = 'https://example.edu/labs/fixture/get-involved/';
const LIVE_URL = 'https://example.edu/labs/fixture/join/';
const INCONCLUSIVE_URL = 'https://example.edu/labs/fixture/apply/';
const EXCERPT = 'We take two undergraduate researchers each term through the department office.';

const seed = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Example Fixture Lab',
    kind: 'lab',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'Studies capillary barrier failure in critically ill newborns.',
    fullDescription:
      'The lab investigates capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.',
    websiteUrl: LIVE_URL,
    sourceUrls: [LIVE_URL, GONE_URL],
    sourceLinkHealth: [
      { url: LIVE_URL, healthStatus: 'HEALTHY', httpStatusCode: 200 },
      { url: GONE_URL, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
      // A server answered, so this is inconclusive and must not withhold anything.
      { url: INCONCLUSIVE_URL, healthStatus: 'UNKNOWN', httpStatusCode: 403 },
    ],
  });
  const signal = (url: string) => ({
    _id: new mongoose.Types.ObjectId(),
    researchEntityId: entityId,
    type: 'RECURRING_PROGRAM',
    archived: false,
    confidence: 'HIGH',
    observedAt: new Date('2026-09-01T00:00:00Z'),
    source: { url, excerpt: EXCERPT },
  });
  await db.collection('signals').insertMany([signal(GONE_URL), signal(INCONCLUSIVE_URL)]);
};

describe('a dead access-signal citation is withheld and the signal stays (#3267)', () => {
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
    for (const name of ['research_entities', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    await seed();
  });

  it('withholds the citation of a page the corpus knows is gone', async () => {
    const detail = await getResearchGroupDetail(SLUG);
    const gone = (detail?.accessSignals ?? []).filter((s: any) => s.excerpt === EXCERPT);

    const goneCitations = gone.filter((s: any) => s.sourceUrl === GONE_URL);
    expect(goneCitations).toHaveLength(0);
  });

  it('keeps the signal and its excerpt, because a 404 is not evidence a programme ended', async () => {
    const detail = await getResearchGroupDetail(SLUG);
    const signals = detail?.accessSignals ?? [];

    expect(signals).toHaveLength(2);
    expect(signals.every((s: any) => s.excerpt === EXCERPT)).toBe(true);
    expect(signals.every((s: any) => s.signalType === 'RECURRING_PROGRAM')).toBe(true);
  });

  it('keeps a citation whose probe was inconclusive, because a server answered', async () => {
    const detail = await getResearchGroupDetail(SLUG);

    expect((detail?.accessSignals ?? []).map((s: any) => s.sourceUrl)).toContain(INCONCLUSIVE_URL);
  });

  // The other half of the policy, pinned beside it: the entity's own citation is
  // provenance and survives qualified, so the same url stays in `sourceUrls` with its
  // `UNAVAILABLE` verdict alongside for the client to render it qualified (#2556).
  it("keeps the same dead url as the entity's own citation, qualified", async () => {
    const detail = await getResearchGroupDetail(SLUG);
    const entity = detail?.researchEntity as Record<string, any> | undefined;

    expect(entity?.sourceUrls).toContain(GONE_URL);
    const verdict = (entity?.sourceLinkHealth ?? []).find((h: any) => h.url === GONE_URL);
    expect(verdict?.healthStatus).toBe('UNAVAILABLE');
  });
});
